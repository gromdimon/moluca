import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import type {
  ResolvedTelegramUserAccount,
  TelegramUserAccountConfig,
  TelegramUserConfig,
} from "./types.js";

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = (cfg.channels?.["telegram-user"] as TelegramUserConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

export function listTelegramUserAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultTelegramUserAccountId(cfg: OpenClawConfig): string {
  const tguConfig = cfg.channels?.["telegram-user"] as TelegramUserConfig | undefined;
  if (tguConfig?.defaultAccount?.trim()) {
    return tguConfig.defaultAccount.trim();
  }
  const ids = listTelegramUserAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): TelegramUserAccountConfig | undefined {
  const accounts = (cfg.channels?.["telegram-user"] as TelegramUserConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId] as TelegramUserAccountConfig | undefined;
}

function mergeTelegramUserAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): TelegramUserAccountConfig {
  const raw = (cfg.channels?.["telegram-user"] ?? {}) as TelegramUserConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw;
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

function resolveApiId(config: TelegramUserAccountConfig): number {
  if (config.apiId) {
    return config.apiId;
  }
  const envApiId = process.env.TELEGRAM_API_ID?.trim();
  if (envApiId) {
    const parsed = Number.parseInt(envApiId, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function resolveApiHash(config: TelegramUserAccountConfig): string {
  if (config.apiHash?.trim()) {
    return config.apiHash.trim();
  }
  return process.env.TELEGRAM_API_HASH?.trim() ?? "";
}

function resolveSessionString(config: TelegramUserAccountConfig): string {
  if (config.sessionString?.trim()) {
    return config.sessionString.trim();
  }
  return process.env.TELEGRAM_SESSION_STRING?.trim() ?? "";
}

export function resolveTelegramUserAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedTelegramUserAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled =
    (params.cfg.channels?.["telegram-user"] as TelegramUserConfig | undefined)?.enabled !== false;
  const merged = mergeTelegramUserAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const apiId = resolveApiId(merged);
  const apiHash = resolveApiHash(merged);
  const sessionString = resolveSessionString(merged);

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    apiId,
    apiHash,
    sessionString,
    config: merged,
  };
}

export type { ResolvedTelegramUserAccount } from "./types.js";
