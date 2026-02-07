import type { OpenClawConfig, MarkdownTableMode, RuntimeEnv } from "openclaw/plugin-sdk";
import type { NewMessageEvent } from "telegram/events";
import { createReplyPrefixOptions } from "openclaw/plugin-sdk";
import type { ResolvedTelegramUserAccount } from "./types.js";
import { setActiveTelegramUserClient } from "./active-client.js";
import { GramJSClient } from "./client.js";
import { getTelegramUserRuntime } from "./runtime.js";

export type TelegramUserMonitorOptions = {
  account: ResolvedTelegramUserAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: {
    linked?: boolean;
    connected?: boolean;
    lastInboundAt?: number;
    lastOutboundAt?: number;
  }) => void;
};

export type TelegramUserMonitorResult = {
  stop: () => void;
};

const TELEGRAM_USER_TEXT_LIMIT = 4096;

type TelegramUserCoreRuntime = ReturnType<typeof getTelegramUserRuntime>;

function logVerbose(core: TelegramUserCoreRuntime, runtime: RuntimeEnv, message: string): void {
  if (core.logging.shouldLogVerbose()) {
    runtime.log(`[telegram-user] ${message}`);
  }
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) {
    return true;
  }
  const normalizedSenderId = senderId.toLowerCase();
  return allowFrom.some((entry) => {
    const normalized = entry.toLowerCase().replace(/^(telegram-user|tgu):/i, "");
    return normalized === normalizedSenderId;
  });
}

function normalizeGroupSlug(raw?: string | null): string {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  if (!trimmed) {
    return "";
  }
  return trimmed
    .replace(/^#/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isGroupAllowed(params: {
  groupId: string;
  groupName?: string | null;
  groups: Record<string, { allow?: boolean; enabled?: boolean }>;
}): boolean {
  const groups = params.groups ?? {};
  const keys = Object.keys(groups);
  if (keys.length === 0) {
    return false;
  }
  const candidates = [
    params.groupId,
    `group:${params.groupId}`,
    params.groupName ?? "",
    normalizeGroupSlug(params.groupName ?? ""),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const entry = groups[candidate];
    if (!entry) {
      continue;
    }
    return entry.allow !== false && entry.enabled !== false;
  }
  const wildcard = groups["*"];
  if (wildcard) {
    return wildcard.allow !== false && wildcard.enabled !== false;
  }
  return false;
}

async function processMessage(
  event: NewMessageEvent,
  account: ResolvedTelegramUserAccount,
  config: OpenClawConfig,
  core: TelegramUserCoreRuntime,
  runtime: RuntimeEnv,
  selfId: string | undefined,
  statusSink?: TelegramUserMonitorOptions["statusSink"],
): Promise<void> {
  const message = event.message;
  const text = message.text?.trim();
  if (!text) {
    return;
  }

  // Skip messages from self.
  const senderId = message.senderId?.toString() ?? "";
  if (selfId && senderId === selfId) {
    return;
  }

  const chatId = message.chatId?.toString() ?? "";
  const isGroup = message.isGroup ?? false;
  const isChannel = message.isChannel ?? false;

  // For channels, treat as group.
  const isGroupLike = isGroup || isChannel;

  // Attempt to derive sender name from the message sender.
  let senderName = "";
  if (message.sender && "firstName" in message.sender) {
    const sender = message.sender as { firstName?: string; lastName?: string; username?: string };
    senderName = [sender.firstName, sender.lastName].filter(Boolean).join(" ");
  }
  const groupName = "";

  const defaultGroupPolicy = config.channels?.defaults?.groupPolicy;
  const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "open";
  const groups = account.config.groups ?? {};
  if (isGroupLike) {
    if (groupPolicy === "disabled") {
      logVerbose(core, runtime, `drop group ${chatId} (groupPolicy=disabled)`);
      return;
    }
    if (groupPolicy === "allowlist") {
      const allowed = isGroupAllowed({ groupId: chatId, groupName, groups });
      if (!allowed) {
        logVerbose(core, runtime, `drop group ${chatId} (not allowlisted)`);
        return;
      }
    }
  }

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const configAllowFrom = (account.config.allowFrom ?? []).map((v) => String(v));
  const rawBody = text;
  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, config);
  const storeAllowFrom =
    !isGroupLike && (dmPolicy !== "open" || shouldComputeAuth)
      ? await core.channel.pairing.readAllowFromStore("telegram-user").catch(() => [])
      : [];
  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = isSenderAllowed(senderId, effectiveAllowFrom);
  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [
          { configured: effectiveAllowFrom.length > 0, allowed: senderAllowedForCommands },
        ],
      })
    : undefined;

  if (!isGroupLike) {
    if (dmPolicy === "disabled") {
      logVerbose(core, runtime, `Blocked DM from ${senderId} (dmPolicy=disabled)`);
      return;
    }

    if (dmPolicy !== "open") {
      const allowed = senderAllowedForCommands;

      if (!allowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: "telegram-user",
            id: senderId,
            meta: { name: senderName || undefined },
          });

          if (created) {
            logVerbose(core, runtime, `pairing request sender=${senderId}`);
            try {
              const client = new GramJSClient({
                apiId: account.apiId,
                apiHash: account.apiHash,
                sessionString: account.sessionString,
              });
              await client.connect();
              await client.sendMessage(
                chatId,
                core.channel.pairing.buildPairingReply({
                  channel: "telegram-user",
                  idLine: `Your Telegram user id: ${senderId}`,
                  code,
                }),
              );
              await client.disconnect();
              statusSink?.({ lastOutboundAt: Date.now() });
            } catch (err) {
              logVerbose(core, runtime, `pairing reply failed for ${senderId}: ${String(err)}`);
            }
          }
        } else {
          logVerbose(
            core,
            runtime,
            `Blocked unauthorized sender ${senderId} (dmPolicy=${dmPolicy})`,
          );
        }
        return;
      }
    }
  }

  if (
    isGroupLike &&
    core.channel.commands.isControlCommandMessage(rawBody, config) &&
    commandAuthorized !== true
  ) {
    logVerbose(core, runtime, `drop control command from unauthorized sender ${senderId}`);
    return;
  }

  const peer = isGroupLike
    ? { kind: "group" as const, id: chatId }
    : { kind: "group" as const, id: senderId };

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "telegram-user",
    accountId: account.accountId,
    peer: {
      kind: peer.kind,
      id: peer.id,
    },
  });

  const fromLabel = isGroupLike ? `group:${chatId}` : senderName || `user:${senderId}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Telegram Personal",
    from: fromLabel,
    timestamp: message.date ? message.date * 1000 : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isGroupLike ? `telegram-user:group:${chatId}` : `telegram-user:${senderId}`,
    To: `telegram-user:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroupLike ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName || undefined,
    SenderId: senderId,
    CommandAuthorized: commandAuthorized,
    Provider: "telegram-user",
    Surface: "telegram-user",
    MessageSid: String(message.id ?? Date.now()),
    OriginatingChannel: "telegram-user",
    OriginatingTo: `telegram-user:${chatId}`,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`telegram-user: failed updating session meta: ${String(err)}`);
    },
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "telegram-user",
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        await deliverTelegramUserReply({
          payload: payload as { text?: string; mediaUrls?: string[]; mediaUrl?: string },
          account,
          chatId,
          isGroup: isGroupLike,
          runtime,
          core,
          config,
          statusSink,
          tableMode: core.channel.text.resolveMarkdownTableMode({
            cfg: config,
            channel: "telegram-user",
            accountId: account.accountId,
          }),
        });
      },
      onError: (err, info) => {
        runtime.error(
          `[${account.accountId}] telegram-user ${info.kind} reply failed: ${String(err)}`,
        );
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
}

async function deliverTelegramUserReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string };
  account: ResolvedTelegramUserAccount;
  chatId: string;
  isGroup: boolean;
  runtime: RuntimeEnv;
  core: TelegramUserCoreRuntime;
  config: OpenClawConfig;
  statusSink?: TelegramUserMonitorOptions["statusSink"];
  tableMode?: MarkdownTableMode;
}): Promise<void> {
  const { payload, account, chatId, runtime, core, config, statusSink } = params;
  const tableMode = params.tableMode ?? "code";
  const text = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);

  const mediaList = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];

  const client = new GramJSClient({
    apiId: account.apiId,
    apiHash: account.apiHash,
    sessionString: account.sessionString,
  });
  await client.connect();

  try {
    if (mediaList.length > 0) {
      let first = true;
      for (const mediaUrl of mediaList) {
        const caption = first ? text : undefined;
        first = false;
        try {
          logVerbose(core, runtime, `Sending media to ${chatId}`);
          await client.sendFile(chatId, mediaUrl, caption);
          statusSink?.({ lastOutboundAt: Date.now() });
        } catch (err) {
          runtime.error(`telegram-user media send failed: ${String(err)}`);
        }
      }
      return;
    }

    if (text) {
      const chunkMode = core.channel.text.resolveChunkMode(
        config,
        "telegram-user",
        account.accountId,
      );
      const chunks = core.channel.text.chunkMarkdownTextWithMode(
        text,
        TELEGRAM_USER_TEXT_LIMIT,
        chunkMode,
      );
      logVerbose(core, runtime, `Sending ${chunks.length} text chunk(s) to ${chatId}`);
      for (const chunk of chunks) {
        try {
          await client.sendMessage(chatId, chunk);
          statusSink?.({ lastOutboundAt: Date.now() });
        } catch (err) {
          runtime.error(`telegram-user message send failed: ${String(err)}`);
        }
      }
    }
  } finally {
    await client.disconnect().catch(() => {});
  }
}

export async function monitorTelegramUserProvider(
  options: TelegramUserMonitorOptions,
): Promise<TelegramUserMonitorResult> {
  const { account, config, abortSignal, statusSink, runtime } = options;
  const core = getTelegramUserRuntime();
  let stopped = false;
  let client: GramJSClient | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveRunning: (() => void) | null = null;

  // Resolve self ID to filter own messages.
  let selfId: string | undefined;

  const stop = () => {
    stopped = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    setActiveTelegramUserClient(account.accountId, null);
    if (client) {
      client.disconnect().catch(() => {});
      client = null;
    }
    resolveRunning?.();
  };

  const startListener = async () => {
    if (stopped || abortSignal.aborted) {
      resolveRunning?.();
      return;
    }

    logVerbose(core, runtime, `[${account.accountId}] connecting GramJS client...`);

    try {
      client = new GramJSClient({
        apiId: account.apiId,
        apiHash: account.apiHash,
        sessionString: account.sessionString,
      });

      await client.connect();
      setActiveTelegramUserClient(account.accountId, client);
      statusSink?.({ linked: true, connected: true });

      // Resolve self identity.
      try {
        const me = await client.getMe();
        if (me && "id" in me) {
          selfId = String((me as { id: bigint }).id);
          logVerbose(core, runtime, `[${account.accountId}] connected as user ${selfId}`);
        }
      } catch {
        // non-critical; continue without self-ID filtering
      }

      client.addMessageHandler(async (event) => {
        logVerbose(core, runtime, `[${account.accountId}] inbound message`);
        statusSink?.({ lastInboundAt: Date.now() });
        try {
          await processMessage(event, account, config, core, runtime, selfId, statusSink);
        } catch (err) {
          runtime.error(`[${account.accountId}] Failed to process message: ${String(err)}`);
        }
      });
    } catch (err) {
      runtime.error(`[${account.accountId}] GramJS connection error: ${String(err)}`);
      if (!stopped && !abortSignal.aborted) {
        logVerbose(core, runtime, `[${account.accountId}] restarting listener in 5s...`);
        restartTimer = setTimeout(() => {
          void startListener();
        }, 5000);
      } else {
        resolveRunning?.();
      }
    }
  };

  const runningPromise = new Promise<void>((resolve) => {
    resolveRunning = resolve;
    abortSignal.addEventListener(
      "abort",
      () => {
        stop();
        resolve();
      },
      { once: true },
    );
  });

  await startListener();

  await runningPromise;

  return { stop };
}
