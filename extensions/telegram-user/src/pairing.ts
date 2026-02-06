import input from "input";
import { GramJSClient } from "./client.js";

export type PairingResult = {
  ok: boolean;
  sessionString?: string;
  error?: string;
};

/**
 * Run the interactive pairing flow: phone number -> code -> optional 2FA -> save session.
 * This is intended for CLI usage during `openclaw channels login telegram-user`.
 */
export async function runPairingFlow(params: {
  apiId: number;
  apiHash: string;
  existingSession?: string;
  onLog?: (msg: string) => void;
}): Promise<PairingResult> {
  const { apiId, apiHash, existingSession, onLog } = params;

  if (!apiId || !apiHash) {
    return {
      ok: false,
      error:
        "Missing apiId or apiHash. Set channels.telegram-user.apiId and channels.telegram-user.apiHash in config, or set TELEGRAM_API_ID and TELEGRAM_API_HASH environment variables.",
    };
  }

  const client = new GramJSClient({ apiId, apiHash, sessionString: existingSession });

  try {
    onLog?.("Starting Telegram user account authentication...");
    onLog?.("You will need your phone number and the verification code Telegram sends you.");

    await client.startInteractive({
      phoneNumber: async () => {
        const phone = await input.text(
          "Enter your phone number (with country code, e.g. +1234567890):",
        );
        return phone.trim();
      },
      phoneCode: async () => {
        const code = await input.text("Enter the verification code sent to your Telegram:");
        return code.trim();
      },
      password: async () => {
        const pwd = await input.text("Enter your 2FA password (leave empty if none):");
        return pwd.trim();
      },
      onError: (err) => {
        onLog?.(`Auth error: ${err.message}`);
      },
    });

    const sessionString = client.saveSession();
    onLog?.("Authentication successful! Session saved.");

    await client.disconnect();

    return { ok: true, sessionString };
  } catch (err) {
    await client.disconnect().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Pairing failed: ${message}` };
  }
}
