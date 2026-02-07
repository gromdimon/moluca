import type {
  ChannelAccountSnapshot,
  ChannelDirectoryEntry,
  ChannelDock,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelPlugin,
  OpenClawConfig,
  GroupToolPolicyConfig,
} from "openclaw/plugin-sdk";
import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  jsonResult,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  readNumberParam,
  readStringParam,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";
import type { ResolvedTelegramUserAccount, TelegramUserConfig } from "./types.js";
import {
  listTelegramUserAccountIds,
  resolveDefaultTelegramUserAccountId,
  resolveTelegramUserAccount,
} from "./accounts.js";
import { getActiveTelegramUserClient } from "./active-client.js";
import { GramJSClient } from "./client.js";
import { TelegramUserConfigSchema } from "./config-schema.js";

const meta = {
  id: "telegram-user",
  label: "Telegram Personal",
  selectionLabel: "Telegram (Personal Account)",
  docsPath: "/channels/telegram-user",
  docsLabel: "telegram-user",
  blurb: "Telegram personal account via MTProto (GramJS).",
  aliases: ["tgu", "telegram"],
  order: 82,
  quickstartAllowFrom: true,
};

function resolveGroupToolPolicy(params: ChannelGroupContext): GroupToolPolicyConfig | undefined {
  const account = resolveTelegramUserAccount({
    cfg: params.cfg,
    accountId: params.accountId ?? undefined,
  });
  const groups = account.config.groups ?? {};
  const groupId = params.groupId?.trim();
  const groupChannel = params.groupChannel?.trim();
  const candidates = [groupId, groupChannel, "*"].filter((value): value is string =>
    Boolean(value),
  );
  for (const key of candidates) {
    const entry = groups[key];
    if (entry?.tools) {
      return entry.tools;
    }
  }
  return undefined;
}

export const telegramUserDock: ChannelDock = {
  id: "telegram-user",
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 4096 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveTelegramUserAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(telegram-user|tgu):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  groups: {
    resolveRequireMention: () => true,
    resolveToolPolicy: resolveGroupToolPolicy,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
};

export const telegramUserPlugin: ChannelPlugin<ResolvedTelegramUserAccount> = {
  id: "telegram-user",
  meta,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.telegram-user"] },
  configSchema: buildChannelConfigSchema(TelegramUserConfigSchema),
  config: {
    listAccountIds: (cfg) => listTelegramUserAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveTelegramUserAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultTelegramUserAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "telegram-user",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "telegram-user",
        accountId,
        clearBaseFields: [
          "apiId",
          "apiHash",
          "sessionString",
          "name",
          "dmPolicy",
          "allowFrom",
          "groupPolicy",
          "groups",
          "messagePrefix",
        ],
      }),
    isConfigured: (account) => Boolean(account.apiId && account.apiHash && account.sessionString),
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.apiId && account.apiHash && account.sessionString),
      linked: Boolean(account.sessionString),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveTelegramUserAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(telegram-user|tgu):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        cfg.channels?.["telegram-user"]?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.telegram-user.accounts.${resolvedAccountId}.`
        : "channels.telegram-user.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("telegram-user"),
        normalizeEntry: (raw) => raw.replace(/^(telegram-user|tgu):/i, ""),
      };
    },
  },
  groups: {
    resolveRequireMention: () => true,
    resolveToolPolicy: resolveGroupToolPolicy,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  actions: {
    listActions: ({ cfg }) => {
      const accounts = listTelegramUserAccountIds(cfg);
      if (accounts.length === 0) {
        return [];
      }
      // Only expose "read" if at least one account is configured.
      const hasConfigured = accounts.some((id) => {
        const account = resolveTelegramUserAccount({ cfg, accountId: id });
        return Boolean(account.apiId && account.apiHash && account.sessionString);
      });
      if (!hasConfigured) {
        return [];
      }
      return ["read"] as ChannelMessageActionName[];
    },
    supportsAction: ({ action }) => action === "read",
    handleAction: async ({ action, params, accountId }) => {
      const client = getActiveTelegramUserClient(accountId);
      if (!client) {
        throw new Error(
          "Telegram-user not connected. Start the gateway with telegram-user enabled.",
        );
      }
      const target = readStringParam(params, "target", { required: true });
      const limit = readNumberParam(params, "limit") ?? 20;
      const messages = await client.getMessages(target, { limit });
      return jsonResult({ ok: true, messages });
    },
  },
  pairing: {
    idLabel: "telegramUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(telegram-user|tgu):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveTelegramUserAccount({ cfg });
      if (!account.apiId || !account.apiHash || !account.sessionString) {
        throw new Error("Telegram user account not configured");
      }
      const client = new GramJSClient({
        apiId: account.apiId,
        apiHash: account.apiHash,
        sessionString: account.sessionString,
      });
      await client.connect();
      try {
        await client.sendMessage(id, "Your pairing request has been approved.");
      } finally {
        await client.disconnect().catch(() => {});
      }
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "telegram-user",
        accountId,
        name,
      }),
    validateInput: () => null,
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg,
        channelKey: "telegram-user",
        accountId,
        name: input.name,
      });
      const next =
        accountId !== DEFAULT_ACCOUNT_ID
          ? migrateBaseNameToDefaultAccount({
              cfg: namedConfig,
              channelKey: "telegram-user",
            })
          : namedConfig;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            "telegram-user": {
              ...(next.channels?.["telegram-user"] as TelegramUserConfig | undefined),
              enabled: true,
            },
          },
        } as OpenClawConfig;
      }
      return {
        ...next,
        channels: {
          ...next.channels,
          "telegram-user": {
            ...(next.channels?.["telegram-user"] as TelegramUserConfig | undefined),
            enabled: true,
            accounts: {
              ...(next.channels?.["telegram-user"] as TelegramUserConfig | undefined)?.accounts,
              [accountId]: {
                ...((next.channels?.["telegram-user"] as TelegramUserConfig | undefined)
                  ?.accounts?.[accountId] ?? {}),
                enabled: true,
              },
            },
          },
        },
      } as OpenClawConfig;
    },
  },
  messaging: {
    normalizeTarget: (raw) => {
      const trimmed = raw?.trim();
      if (!trimmed) {
        return undefined;
      }
      return trimmed.replace(/^(telegram-user|tgu):/i, "");
    },
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) {
          return false;
        }
        // Telegram user/chat IDs are numeric, or @username.
        return /^-?\d{3,}$/.test(trimmed) || /^@\w+$/.test(trimmed);
      },
      hint: "<chatId|@username>",
    },
  },
  directory: {
    self: async ({ cfg, accountId }) => {
      const account = resolveTelegramUserAccount({ cfg, accountId });
      if (!account.apiId || !account.apiHash || !account.sessionString) {
        return null;
      }
      const client = new GramJSClient({
        apiId: account.apiId,
        apiHash: account.apiHash,
        sessionString: account.sessionString,
      });
      try {
        await client.connect();
        const me = await client.getMe();
        if (!me || !("id" in me)) {
          return null;
        }
        const user = me as {
          id: bigint;
          firstName?: string;
          lastName?: string;
          username?: string;
        };
        return {
          kind: "user" as const,
          id: String(user.id),
          name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
          handle: user.username ?? undefined,
          raw: me,
        };
      } catch {
        return null;
      } finally {
        await client.disconnect().catch(() => {});
      }
    },
    listPeers: async () => {
      // Not implemented; config-based peers only for now.
      return [];
    },
    listGroups: async () => {
      // Not implemented; config-based groups only for now.
      return [];
    },
  },
  auth: {
    login: async ({ cfg, accountId, runtime }) => {
      const account = resolveTelegramUserAccount({
        cfg,
        accountId: accountId ?? DEFAULT_ACCOUNT_ID,
      });
      if (!account.apiId || !account.apiHash) {
        throw new Error(
          "Missing apiId/apiHash. Set channels.telegram-user.apiId and channels.telegram-user.apiHash, or TELEGRAM_API_ID and TELEGRAM_API_HASH env vars. Get these from https://my.telegram.org",
        );
      }
      runtime.log(
        `Starting Telegram user account login for account "${account.accountId}". Follow the prompts.`,
      );
      const { runPairingFlow } = await import("./pairing.js");
      const result = await runPairingFlow({
        apiId: account.apiId,
        apiHash: account.apiHash,
        existingSession: account.sessionString || undefined,
        onLog: (msg) => runtime.log(msg),
      });
      if (!result.ok) {
        throw new Error(result.error ?? "Login failed");
      }
      runtime.log(
        `Login successful. Save this session string in your config:\n` +
          `  channels.telegram-user.sessionString: "${result.sessionString}"`,
      );
    },
  },
  outbound: {
    deliveryMode: "gateway",
    chunker: (text, limit) => {
      if (!text) {
        return [];
      }
      if (limit <= 0 || text.length <= limit) {
        return [text];
      }
      const chunks: string[] = [];
      let remaining = text;
      while (remaining.length > limit) {
        const window = remaining.slice(0, limit);
        const lastNewline = window.lastIndexOf("\n");
        const lastSpace = window.lastIndexOf(" ");
        let breakIdx = lastNewline > 0 ? lastNewline : lastSpace;
        if (breakIdx <= 0) {
          breakIdx = limit;
        }
        const rawChunk = remaining.slice(0, breakIdx);
        const chunk = rawChunk.trimEnd();
        if (chunk.length > 0) {
          chunks.push(chunk);
        }
        const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
        const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
        remaining = remaining.slice(nextStart).trimStart();
      }
      if (remaining.length) {
        chunks.push(remaining);
      }
      return chunks;
    },
    chunkerMode: "text",
    textChunkLimit: 4096,
    sendText: async ({ to, text, accountId, cfg }) => {
      const account = resolveTelegramUserAccount({ cfg, accountId });
      const client = new GramJSClient({
        apiId: account.apiId,
        apiHash: account.apiHash,
        sessionString: account.sessionString,
      });
      await client.connect();
      try {
        const result = await client.sendMessage(to, text);
        return {
          channel: "telegram-user" as const,
          ok: true,
          messageId: String(result.messageId),
        };
      } catch (err) {
        return {
          channel: "telegram-user" as const,
          ok: false,
          messageId: "",
          error: err instanceof Error ? err : new Error(String(err)),
        };
      } finally {
        await client.disconnect().catch(() => {});
      }
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      const account = resolveTelegramUserAccount({ cfg, accountId });
      const client = new GramJSClient({
        apiId: account.apiId,
        apiHash: account.apiHash,
        sessionString: account.sessionString,
      });
      await client.connect();
      try {
        if (mediaUrl) {
          const result = await client.sendFile(to, mediaUrl, text || undefined);
          return {
            channel: "telegram-user" as const,
            ok: true,
            messageId: String(result.messageId),
          };
        }
        const result = await client.sendMessage(to, text);
        return {
          channel: "telegram-user" as const,
          ok: true,
          messageId: String(result.messageId),
        };
      } catch (err) {
        return {
          channel: "telegram-user" as const,
          ok: false,
          messageId: "",
          error: err instanceof Error ? err : new Error(String(err)),
        };
      } finally {
        await client.disconnect().catch(() => {});
      }
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) => {
      const issues = [];
      for (const snapshot of accounts) {
        if (!snapshot.configured) {
          issues.push({
            channel: "telegram-user" as const,
            accountId: snapshot.accountId,
            kind: "config" as const,
            message:
              "Telegram user account not configured (missing apiId, apiHash, or sessionString).",
            fix: "Set channels.telegram-user.apiId, channels.telegram-user.apiHash, and channels.telegram-user.sessionString. Get API credentials from https://my.telegram.org",
          });
        }
      }
      return issues;
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      linked: snapshot.linked ?? false,
      connected: snapshot.connected ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    probeAccount: async ({ account }) => {
      // Attempt a lightweight connection check.
      if (!account.apiId || !account.apiHash || !account.sessionString) {
        return { ok: false, error: "not configured" };
      }
      const client = new GramJSClient({
        apiId: account.apiId,
        apiHash: account.apiHash,
        sessionString: account.sessionString,
      });
      try {
        await client.connect();
        const me = await client.getMe();
        await client.disconnect();
        if (!me || !("id" in me)) {
          return { ok: false, error: "unable to retrieve user identity" };
        }
        const user = me as {
          id: bigint;
          firstName?: string;
          lastName?: string;
          username?: string;
        };
        return {
          ok: true,
          user: {
            id: String(user.id),
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
          },
        };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
    buildAccountSnapshot: async ({ account, runtime }) => {
      const configured = Boolean(account.apiId && account.apiHash && account.sessionString);
      const linked = Boolean(account.sessionString) || (runtime?.linked ?? false);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        linked,
        connected: runtime?.connected ?? false,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: configured
          ? (runtime?.lastError ?? null)
          : (runtime?.lastError ?? "not configured"),
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        dmPolicy: account.config.dmPolicy ?? "pairing",
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      let userLabel = "";
      if (account.apiId && account.apiHash && account.sessionString) {
        try {
          const client = new GramJSClient({
            apiId: account.apiId,
            apiHash: account.apiHash,
            sessionString: account.sessionString,
          });
          await client.connect();
          const me = await client.getMe();
          await client.disconnect();
          if (me && "firstName" in me) {
            const user = me as { firstName?: string; username?: string };
            userLabel = ` (${user.firstName ?? ""}${user.username ? ` @${user.username}` : ""})`;
          }
        } catch {
          // ignore probe errors
        }
      }
      ctx.log?.info(`[${account.accountId}] starting telegram-user provider${userLabel}`);
      const { monitorTelegramUserProvider } = await import("./monitor.js");
      return monitorTelegramUserProvider({
        account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
    },
    logoutAccount: async ({ cfg, accountId }) => {
      // Clear the sessionString from config.
      const nextCfg = { ...cfg } as OpenClawConfig;
      const tguSection = cfg.channels?.["telegram-user"]
        ? { ...(cfg.channels["telegram-user"] as TelegramUserConfig) }
        : undefined;
      let cleared = false;
      let changed = false;

      if (tguSection) {
        if (accountId === DEFAULT_ACCOUNT_ID && tguSection.sessionString) {
          delete tguSection.sessionString;
          cleared = true;
          changed = true;
        }
        const accounts =
          tguSection.accounts && typeof tguSection.accounts === "object"
            ? { ...tguSection.accounts }
            : undefined;
        if (accounts && accountId in accounts) {
          const entry = accounts[accountId];
          if (entry && typeof entry === "object") {
            const nextEntry = { ...entry } as Record<string, unknown>;
            if ("sessionString" in nextEntry) {
              if (nextEntry.sessionString) {
                cleared = true;
              }
              delete nextEntry.sessionString;
              changed = true;
            }
            if (Object.keys(nextEntry).length === 0) {
              delete accounts[accountId];
              changed = true;
            } else {
              accounts[accountId] = nextEntry as typeof entry;
            }
          }
        }
        if (accounts) {
          if (Object.keys(accounts).length === 0) {
            delete tguSection.accounts;
            changed = true;
          } else {
            tguSection.accounts = accounts;
          }
        }
      }

      if (changed && tguSection) {
        if (Object.keys(tguSection).length > 0) {
          nextCfg.channels = { ...nextCfg.channels, "telegram-user": tguSection };
        } else {
          const nextChannels = { ...nextCfg.channels };
          delete nextChannels["telegram-user"];
          if (Object.keys(nextChannels).length > 0) {
            nextCfg.channels = nextChannels;
          } else {
            delete nextCfg.channels;
          }
        }
      }

      return { cleared, loggedOut: cleared };
    },
  },
};
