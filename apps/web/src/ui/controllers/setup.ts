import type { GatewayBrowserClient } from "../gateway.ts";

export type ChannelAccountStatus = {
  accountId: string;
  linked?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  lastError?: string | null;
};

export type SetupWhatsAppState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  whatsappBusy: boolean;
  whatsappLoginMessage: string | null;
  whatsappLoginQrDataUrl: string | null;
  whatsappLoginConnected: boolean | null;
  whatsappStatus: ChannelAccountStatus | null;
};

export type TelegramUserStep = "credentials" | "code" | "2fa" | "done";

export type SetupTelegramUserState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  telegramUserBusy: boolean;
  telegramUserStep: TelegramUserStep;
  telegramUserMessage: string | null;
  telegramUserError: string | null;
  telegramUserApiId: string;
  telegramUserApiHash: string;
  telegramUserPhone: string;
  telegramUserCode: string;
  telegramUserPassword: string;
  telegramUserStatus: ChannelAccountStatus | null;
};

// ---------- Channel status ----------

export async function loadChannelStatus(
  state: SetupWhatsAppState & SetupTelegramUserState,
) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{
      channelAccounts?: Record<string, ChannelAccountStatus[]>;
    }>("channels.status", { probe: false, timeoutMs: 8000 });
    const waAccounts = res?.channelAccounts?.whatsapp;
    state.whatsappStatus = waAccounts?.[0] ?? null;
    const tgUserAccounts = res?.channelAccounts?.["telegram-user"];
    state.telegramUserStatus = tgUserAccounts?.[0] ?? null;
  } catch {
    // ignore — status is optional
  }
}

// ---------- WhatsApp ----------

export async function startWhatsApp(state: SetupWhatsAppState, force: boolean) {
  if (!state.client || !state.connected) {
    return;
  }
  state.whatsappBusy = true;
  state.whatsappLoginMessage = null;
  state.whatsappLoginQrDataUrl = null;
  state.whatsappLoginConnected = null;
  try {
    const res = await state.client.request<{
      message?: string;
      qrDataUrl?: string;
      connected?: boolean;
    }>("web.login.start", { force, timeoutMs: 30000 });
    state.whatsappLoginMessage = res?.message ?? null;
    state.whatsappLoginQrDataUrl = res?.qrDataUrl ?? null;
    state.whatsappLoginConnected = res?.connected ?? null;
    // Auto-wait for QR scan after displaying the QR code
    if (res?.qrDataUrl && !res?.connected) {
      waitWhatsApp(state);
    }
  } catch (err) {
    state.whatsappLoginMessage = `Error: ${String(err)}`;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function waitWhatsApp(state: SetupWhatsAppState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{
      message?: string;
      connected?: boolean;
    }>("web.login.wait", { timeoutMs: 120000 });
    state.whatsappLoginMessage = res?.message ?? null;
    state.whatsappLoginConnected = res?.connected ?? null;
    if (res?.connected) {
      state.whatsappLoginQrDataUrl = null;
      state.whatsappStatus = { accountId: "default", linked: true, connected: true, running: true };
    }
  } catch (err) {
    state.whatsappLoginMessage = `Error: ${String(err)}`;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function logoutWhatsApp(state: SetupWhatsAppState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.whatsappBusy = true;
  state.whatsappLoginMessage = null;
  try {
    await state.client.request("channels.logout", { channel: "whatsapp" });
    state.whatsappStatus = null;
    state.whatsappLoginConnected = null;
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginMessage = "WhatsApp logged out.";
  } catch (err) {
    state.whatsappLoginMessage = `Error: ${String(err)}`;
  } finally {
    state.whatsappBusy = false;
  }
}

// ---------- Telegram User (MTProto) ----------

export async function sendTelegramUserCode(state: SetupTelegramUserState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.telegramUserBusy = true;
  state.telegramUserError = null;
  state.telegramUserMessage = null;
  try {
    await state.client.request<{ phoneCodeHash?: string }>(
      "telegram-user.login.sendCode",
      {
        apiId: Number.parseInt(state.telegramUserApiId, 10),
        apiHash: state.telegramUserApiHash.trim(),
        phoneNumber: state.telegramUserPhone.trim(),
        timeoutMs: 30000,
      },
    );
    state.telegramUserStep = "code";
    state.telegramUserMessage = "Verification code sent. Check your Telegram app or SMS.";
  } catch (err) {
    state.telegramUserError = `Error: ${String(err)}`;
  } finally {
    state.telegramUserBusy = false;
  }
}

export async function verifyTelegramUserCode(state: SetupTelegramUserState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.telegramUserBusy = true;
  state.telegramUserError = null;
  state.telegramUserMessage = null;
  try {
    const res = await state.client.request<{
      connected?: boolean;
      needs2fa?: boolean;
    }>("telegram-user.login.verifyCode", {
      code: state.telegramUserCode.trim(),
      timeoutMs: 30000,
    });
    if (res?.needs2fa) {
      state.telegramUserStep = "2fa";
      state.telegramUserMessage = "Two-factor authentication required. Enter your password.";
    } else if (res?.connected) {
      state.telegramUserStep = "done";
      state.telegramUserMessage = "Telegram connected successfully!";
      state.telegramUserStatus = {
        accountId: "default",
        linked: true,
        connected: true,
        running: true,
      };
    }
  } catch (err) {
    state.telegramUserError = `Error: ${String(err)}`;
  } finally {
    state.telegramUserBusy = false;
  }
}

export async function verifyTelegramUser2fa(state: SetupTelegramUserState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.telegramUserBusy = true;
  state.telegramUserError = null;
  state.telegramUserMessage = null;
  try {
    const res = await state.client.request<{ connected?: boolean }>(
      "telegram-user.login.verify2fa",
      {
        password: state.telegramUserPassword,
        timeoutMs: 30000,
      },
    );
    if (res?.connected) {
      state.telegramUserStep = "done";
      state.telegramUserMessage = "Telegram connected successfully!";
      state.telegramUserStatus = {
        accountId: "default",
        linked: true,
        connected: true,
        running: true,
      };
    }
  } catch (err) {
    state.telegramUserError = `Error: ${String(err)}`;
  } finally {
    state.telegramUserBusy = false;
  }
}

export async function logoutTelegramUser(state: SetupTelegramUserState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.telegramUserBusy = true;
  state.telegramUserMessage = null;
  state.telegramUserError = null;
  try {
    await state.client.request("channels.logout", { channel: "telegram-user" });
    state.telegramUserStatus = null;
    state.telegramUserStep = "credentials";
    state.telegramUserMessage = "Telegram logged out.";
  } catch (err) {
    state.telegramUserError = `Error: ${String(err)}`;
  } finally {
    state.telegramUserBusy = false;
  }
}
