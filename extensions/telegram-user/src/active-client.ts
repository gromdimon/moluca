import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { GramJSClient } from "./client.js";

const clients = new Map<string, GramJSClient>();

function resolveAccountKey(accountId?: string | null): string {
  return (accountId ?? "").trim() || DEFAULT_ACCOUNT_ID;
}

export function setActiveTelegramUserClient(
  accountId: string | null | undefined,
  client: GramJSClient | null,
): void {
  const key = resolveAccountKey(accountId);
  if (client) {
    clients.set(key, client);
  } else {
    clients.delete(key);
  }
}

export function getActiveTelegramUserClient(accountId?: string | null): GramJSClient | null {
  const key = resolveAccountKey(accountId);
  return clients.get(key) ?? null;
}

export function requireActiveTelegramUserClient(accountId?: string | null): GramJSClient {
  const key = resolveAccountKey(accountId);
  const client = clients.get(key) ?? null;
  if (!client) {
    throw new Error(
      `No active telegram-user client (account: ${key}). Start the gateway with telegram-user enabled.`,
    );
  }
  return client;
}
