import type { MolucaApp } from "./app.ts";
import type { GatewayEventFrame, GatewayHelloOk } from "./gateway.ts";
import type { UiSettings } from "./storage.ts";
import { flushChatQueueForEvent } from "./app-chat.ts";
import { handleAgentEvent, resetToolStream, type AgentEventPayload } from "./app-tool-stream.ts";
import { loadAssistantIdentity } from "./controllers/assistant-identity.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import { handleChatEvent, type ChatEventPayload } from "./controllers/chat.ts";
import { handleInboxEvent, loadInbox } from "./controllers/inbox.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { loadChannelStatus } from "./controllers/setup.ts";
import { GatewayBrowserClient } from "./gateway.ts";
import { saveSettings } from "./storage.ts";

type GatewayHost = {
  settings: UiSettings;
  password: string;
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello: GatewayHelloOk | null;
  lastError: string | null;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  sessionKey: string;
  chatRunId: string | null;
  refreshSessionsAfterChat: Set<string>;
};

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainKey?: string;
  mainSessionKey?: string;
};

function normalizeSessionKeyForDefaults(
  value: string | undefined,
  defaults: SessionDefaultsSnapshot,
): string {
  const raw = (value ?? "").trim();
  const mainSessionKey = defaults.mainSessionKey?.trim();
  if (!mainSessionKey) {
    return raw;
  }
  if (!raw) {
    return mainSessionKey;
  }
  const mainKey = defaults.mainKey?.trim() || "main";
  const defaultAgentId = defaults.defaultAgentId?.trim();
  const isAlias =
    raw === "main" ||
    raw === mainKey ||
    (defaultAgentId &&
      (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`));
  return isAlias ? mainSessionKey : raw;
}

function applySessionDefaults(host: GatewayHost, defaults?: SessionDefaultsSnapshot) {
  if (!defaults?.mainSessionKey) {
    return;
  }
  const resolvedSessionKey = normalizeSessionKeyForDefaults(host.sessionKey, defaults);
  const resolvedSettingsSessionKey = normalizeSessionKeyForDefaults(
    host.settings.sessionKey,
    defaults,
  );
  const nextSessionKey = resolvedSessionKey || resolvedSettingsSessionKey || host.sessionKey;
  const nextSettings = {
    ...host.settings,
    sessionKey: resolvedSettingsSessionKey || nextSessionKey,
  };
  if (nextSessionKey !== host.sessionKey) {
    host.sessionKey = nextSessionKey;
  }
  if (nextSettings.sessionKey !== host.settings.sessionKey) {
    host.settings = nextSettings;
    saveSettings(nextSettings);
  }
}

export const CHAT_SESSIONS_ACTIVE_MINUTES = 120;

export function connectGateway(host: GatewayHost) {
  host.lastError = null;
  host.hello = null;
  host.connected = false;

  host.client?.stop();
  host.client = new GatewayBrowserClient({
    url: host.settings.gatewayUrl,
    token: host.settings.token.trim() ? host.settings.token : undefined,
    password: host.password.trim() ? host.password : undefined,
    clientName: "webchat" as const,
    mode: "webchat",
    onHello: (hello) => {
      host.connected = true;
      host.lastError = null;
      host.hello = hello;
      applySnapshot(host, hello);
      host.chatRunId = null;
      (host as unknown as { chatStream: string | null }).chatStream = null;
      (host as unknown as { chatStreamStartedAt: number | null }).chatStreamStartedAt = null;
      resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
      void loadAssistantIdentity(host as unknown as MolucaApp);
      void loadChatHistory(host as unknown as MolucaApp);
      void loadSessions(host as unknown as MolucaApp, {
        activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
      });
      void loadChannelStatus(host as unknown as MolucaApp);
      void loadInbox(host as unknown as MolucaApp);
    },
    onClose: ({ code, reason }) => {
      host.connected = false;
      if (code !== 1012) {
        host.lastError = `disconnected (${code}): ${reason || "no reason"}`;
      }
    },
    onEvent: (evt) => handleGatewayEvent(host, evt),
    onGap: ({ expected, received }) => {
      host.lastError = `event gap detected (expected seq ${expected}, got ${received}); refresh recommended`;
    },
  });
  host.client.start();
}

export function handleGatewayEvent(host: GatewayHost, evt: GatewayEventFrame) {
  try {
    handleGatewayEventUnsafe(host, evt);
  } catch (err) {
    console.error("[gateway] handleGatewayEvent error:", evt.event, err);
  }
}

function handleGatewayEventUnsafe(host: GatewayHost, evt: GatewayEventFrame) {
  if (evt.event === "agent") {
    handleAgentEvent(
      host as unknown as Parameters<typeof handleAgentEvent>[0],
      evt.payload as AgentEventPayload | undefined,
    );
    return;
  }

  if (evt.event === "inbox") {
    handleInboxEvent(host as unknown as MolucaApp, evt.payload);
    return;
  }

  if (evt.event === "chat") {
    const payload = evt.payload as ChatEventPayload | undefined;
    const state = handleChatEvent(host as unknown as MolucaApp, payload);
    if (state === "final" || state === "error" || state === "aborted") {
      resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
      void flushChatQueueForEvent(host as unknown as Parameters<typeof flushChatQueueForEvent>[0]);
      const runId = payload?.runId;
      if (runId && host.refreshSessionsAfterChat.has(runId)) {
        host.refreshSessionsAfterChat.delete(runId);
        if (state === "final") {
          void loadSessions(host as unknown as MolucaApp, {
            activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
          });
        }
      }
    }
    if (state === "final") {
      void loadChatHistory(host as unknown as MolucaApp);
    }
    return;
  }
}

export function applySnapshot(host: GatewayHost, hello: GatewayHelloOk) {
  const snapshot = hello.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  if (snapshot?.sessionDefaults) {
    applySessionDefaults(host, snapshot.sessionDefaults);
  }
}
