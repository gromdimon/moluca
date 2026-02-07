import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TelegramClient, Api } from "telegram";
import { computeCheck } from "telegram/Password";
import { StringSession } from "telegram/sessions";

type ActiveLogin = {
  client: TelegramClient;
  session: StringSession;
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  phoneCodeHash: string;
  startedAt: number;
};

const ACTIVE_LOGIN_TTL_MS = 3 * 60_000;
let activeLogin: ActiveLogin | null = null;

function cleanupIfExpired() {
  if (activeLogin && Date.now() - activeLogin.startedAt > ACTIVE_LOGIN_TTL_MS) {
    try {
      activeLogin.client.disconnect();
    } catch {}
    activeLogin = null;
  }
}

async function resetActiveLogin() {
  if (activeLogin) {
    try {
      await activeLogin.client.disconnect();
    } catch {}
    activeLogin = null;
  }
}

const CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

async function saveCredentialsToConfig(apiId: number, apiHash: string, sessionString: string) {
  const raw = await readFile(CONFIG_PATH, "utf-8");
  const config = JSON.parse(raw);
  if (!config.channels) config.channels = {};
  if (!config.channels["telegram-user"]) config.channels["telegram-user"] = {};
  config.channels["telegram-user"].apiId = apiId;
  config.channels["telegram-user"].apiHash = apiHash;
  config.channels["telegram-user"].sessionString = sessionString;
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

type HandlerOpts = {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: unknown) => void;
  context: {
    startChannel: (channel: string, accountId?: string) => Promise<void>;
    stopChannel: (channel: string, accountId?: string) => Promise<void>;
  };
};

export async function handleSendCode({ params, respond }: HandlerOpts) {
  cleanupIfExpired();

  const apiId =
    typeof params.apiId === "number"
      ? params.apiId
      : typeof params.apiId === "string"
        ? Number.parseInt(params.apiId, 10)
        : NaN;
  const apiHash = typeof params.apiHash === "string" ? params.apiHash.trim() : "";
  const phoneNumber = typeof params.phoneNumber === "string" ? params.phoneNumber.trim() : "";

  if (!apiId || Number.isNaN(apiId)) {
    respond(false, undefined, { code: -1, message: "apiId is required (number)" });
    return;
  }
  if (!apiHash) {
    respond(false, undefined, { code: -1, message: "apiHash is required" });
    return;
  }
  if (!phoneNumber) {
    respond(false, undefined, { code: -1, message: "phoneNumber is required" });
    return;
  }

  await resetActiveLogin();

  try {
    const session = new StringSession("");
    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 3,
    });
    await client.connect();

    const result = await client.sendCode({ apiId, apiHash }, phoneNumber);

    activeLogin = {
      client,
      session,
      apiId,
      apiHash,
      phoneNumber,
      phoneCodeHash: result.phoneCodeHash,
      startedAt: Date.now(),
    };

    respond(true, { phoneCodeHash: result.phoneCodeHash });
  } catch (err) {
    await resetActiveLogin();
    respond(false, undefined, {
      code: -1,
      message: `Failed to send code: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export async function handleVerifyCode({ params, respond, context }: HandlerOpts) {
  cleanupIfExpired();

  const code = typeof params.code === "string" ? params.code.trim() : "";
  if (!code) {
    respond(false, undefined, { code: -1, message: "code is required" });
    return;
  }

  if (!activeLogin) {
    respond(false, undefined, {
      code: -1,
      message: "No active login session. Call telegram-user.login.sendCode first.",
    });
    return;
  }

  const login = activeLogin;
  try {
    await login.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: login.phoneNumber,
        phoneCodeHash: login.phoneCodeHash,
        phoneCode: code,
      }),
    );
    // Success — save and finish
    await finishLogin(login, context, respond);
  } catch (err: unknown) {
    const errorMessage =
      err && typeof err === "object" && "errorMessage" in err
        ? (err as { errorMessage: string }).errorMessage
        : "";
    if (errorMessage === "SESSION_PASSWORD_NEEDED") {
      respond(true, { needs2fa: true });
      return;
    }
    respond(false, undefined, {
      code: -1,
      message: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export async function handleVerify2fa({ params, respond, context }: HandlerOpts) {
  cleanupIfExpired();

  const password = typeof params.password === "string" ? params.password : "";
  if (!password) {
    respond(false, undefined, { code: -1, message: "password is required" });
    return;
  }

  if (!activeLogin) {
    respond(false, undefined, {
      code: -1,
      message: "No active login session. Call telegram-user.login.sendCode first.",
    });
    return;
  }

  const login = activeLogin;
  try {
    const passwordResult = await login.client.invoke(new Api.account.GetPassword());
    const srp = await computeCheck(passwordResult, password);
    await login.client.invoke(new Api.auth.CheckPassword({ password: srp }));
    await finishLogin(login, context, respond);
  } catch (err) {
    respond(false, undefined, {
      code: -1,
      message: `2FA verification failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

async function finishLogin(
  login: ActiveLogin,
  context: HandlerOpts["context"],
  respond: HandlerOpts["respond"],
) {
  try {
    const sessionString = login.session.save() as unknown as string;
    await saveCredentialsToConfig(login.apiId, login.apiHash, sessionString);
    await login.client.disconnect();
    activeLogin = null;
    // Wait for config cache to expire (200ms TTL) then start the channel
    await new Promise((r) => setTimeout(r, 300));
    try {
      await context.startChannel("telegram-user");
    } catch {
      // Channel start may fail if plugin not fully enabled yet — that's ok
    }
    respond(true, { connected: true });
  } catch (err) {
    respond(false, undefined, {
      code: -1,
      message: `Failed to save session: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
