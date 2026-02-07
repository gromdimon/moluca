import { html, nothing } from "lit";
import type { MolucaApp } from "./app.ts";
import { refreshChat } from "./app-chat.ts";
import { CHAT_SESSIONS_ACTIVE_MINUTES } from "./app-gateway.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import { dismissInboxEntry, loadInbox, markInboxRead } from "./controllers/inbox.ts";
import { createNewSession, deleteSession, loadSessions } from "./controllers/sessions.ts";
import { formatAgo } from "./format.ts";
import { icons } from "./icons.ts";
import { formatSessionTokens } from "./presenter.ts";
import { renderChat } from "./views/chat.ts";
import { renderConnect } from "./views/connect.ts";
import { renderSetupTelegramUser } from "./views/setup-telegram-user.ts";
import { renderSetupWhatsApp } from "./views/setup-whatsapp.ts";
import {
  loadChannelStatus,
  logoutTelegramUser,
  logoutWhatsApp,
  sendTelegramUserCode,
  startWhatsApp,
  verifyTelegramUser2fa,
  verifyTelegramUserCode,
  waitWhatsApp,
} from "./controllers/setup.ts";
import {
  loadWorkspaceFile,
  saveWorkspaceFile,
  type WorkspaceFileState,
} from "./controllers/workspace-files.ts";

export type Screen = "connect" | "chat" | "setup-whatsapp" | "setup-telegram-user";

export function renderApp(state: MolucaApp) {
  const screen = state.screen;

  return html`
    <div class="moluca-shell ${state.connected ? "moluca-shell--connected" : ""}" data-theme=${state.themeResolved}>
      ${
        screen === "connect"
          ? nothing
          : html`
            <header class="moluca-topbar">
              <div class="moluca-topbar__left">
                <button
                  class="btn btn--icon"
                  title="Sessions"
                  @click=${() => state.toggleSessionsSidebar()}
                >
                  ${icons.menu}
                </button>
              </div>
              <div class="moluca-topbar__center">
                <div class="moluca-brand">
                  <span class="moluca-brand__logo">M</span>
                  <span class="moluca-brand__text">Moluca</span>
                </div>
              </div>
              <div class="moluca-topbar__right">
                ${renderInboxButton(state)}
                ${renderSettingsDropdown(state)}
              </div>
            </header>
          `
      }

      ${renderSessionsSidebar(state)}

      ${renderInboxPanel(state)}

      ${renderConnectionsModal(state)}

      ${renderWorkspaceEditModal(state)}

      ${renderSettingsDropdownOverlay(state)}

      <main class="moluca-content ${screen === "connect" ? "moluca-content--connect" : ""}">
        ${screen === "connect" ? renderConnectScreen(state) : nothing}
        ${screen === "chat" ? renderChatScreen(state) : nothing}
        ${screen === "setup-whatsapp" ? renderWhatsAppScreen(state) : nothing}
        ${screen === "setup-telegram-user" ? renderTelegramUserScreen(state) : nothing}
      </main>
    </div>
  `;
}

function renderSettingsDropdown(state: MolucaApp) {
  return html`
    <div class="settings-dropdown">
      <button
        class="btn btn--icon ${state.settingsDropdownOpen ? "active" : ""}"
        title="Settings"
        @click=${(e: Event) => {
          e.stopPropagation();
          state.settingsDropdownOpen = !state.settingsDropdownOpen;
        }}
      >
        ${icons.settings}
      </button>
    </div>
  `;
}

function renderSettingsDropdownOverlay(state: MolucaApp) {
  if (!state.settingsDropdownOpen) return nothing;

  return html`
    <div class="settings-dropdown-overlay">
      <div class="settings-dropdown-backdrop" @click=${() => (state.settingsDropdownOpen = false)}></div>
      <div class="settings-dropdown__menu settings-dropdown__menu--fixed">
        <button
          class="settings-dropdown__item"
          @click=${() => {
            state.settingsDropdownOpen = false;
            state.connectionsModalOpen = true;
            if (state.connected) {
              void loadChannelStatus(state);
            }
          }}
        >
          ${icons.plug}
          <span>Connections</span>
        </button>
        <button
          class="settings-dropdown__item"
          @click=${() => {
            state.settingsDropdownOpen = false;
            state.workspaceEditModalOpen = true;
            state.workspaceEditTab = "soul";
            void loadWorkspaceFile(state as unknown as WorkspaceFileState, "SOUL.md");
          }}
        >
          ${icons.pencil}
          <span>Customize</span>
        </button>
        <button
          class="settings-dropdown__item"
          @click=${() => {
            state.settingsDropdownOpen = false;
            const next = state.themeResolved === "dark" ? "light" : "dark";
            state.setTheme(next);
          }}
        >
          ${icons.circle}
          <span>Theme: ${state.themeResolved === "dark" ? "Dark" : "Light"}</span>
        </button>
        <div class="settings-dropdown__divider"></div>
        <button
          class="settings-dropdown__item settings-dropdown__item--danger"
          @click=${() => {
            state.settingsDropdownOpen = false;
            state.client?.stop();
            state.client = null;
            state.connected = false;
            state.screen = "connect";
          }}
        >
          ${icons.x}
          <span>Disconnect</span>
        </button>
      </div>
    </div>
  `;
}

function renderConnectScreen(state: MolucaApp) {
  return renderConnect({
    gatewayUrl: state.settings.gatewayUrl,
    token: state.settings.token,
    password: state.password,
    lastError: state.lastError,
    connecting: false,
    onGatewayUrlChange: (next) => {
      state.applySettings({ ...state.settings, gatewayUrl: next });
    },
    onTokenChange: (next) => {
      state.applySettings({ ...state.settings, token: next });
    },
    onPasswordChange: (next) => {
      state.password = next;
    },
    onConnect: () => state.connect(),
  });
}

function switchSession(state: MolucaApp, next: string) {
  state.sessionKey = next;
  state.chatMessage = "";
  state.chatAttachments = [];
  state.chatStream = null;
  state.chatStreamStartedAt = null;
  state.chatRunId = null;
  state.chatQueue = [];
  state.resetToolStream();
  state.resetChatScroll();
  state.applySettings({ ...state.settings, sessionKey: next });
  void state.loadAssistantIdentity();
  void loadChatHistory(state);
}

function renderChatScreen(state: MolucaApp) {
  const showThinking = state.settings.chatShowThinking;
  const chatDisabledReason = state.connected ? null : "Disconnected from gateway.";

  return renderChat({
    sessionKey: state.sessionKey,
    onSessionKeyChange: (next) => switchSession(state, next),
    thinkingLevel: state.chatThinkingLevel,
    showThinking,
    loading: state.chatLoading,
    sending: state.chatSending,
    compactionStatus: state.compactionStatus,
    assistantAvatarUrl: state.chatAvatarUrl,
    messages: state.chatMessages,
    toolMessages: state.chatToolMessages,
    stream: state.chatStream,
    streamStartedAt: state.chatStreamStartedAt,
    draft: state.chatMessage,
    queue: state.chatQueue,
    connected: state.connected,
    canSend: state.connected,
    disabledReason: chatDisabledReason,
    error: state.lastError,
    sessions: state.sessionsResult,
    focusMode: false,
    onRefresh: () => {
      state.resetToolStream();
      return refreshChat(state);
    },
    onToggleFocusMode: () => {},
    onChatScroll: (event) => state.handleChatScroll(event),
    onDraftChange: (next) => (state.chatMessage = next),
    attachments: state.chatAttachments,
    onAttachmentsChange: (next) => (state.chatAttachments = next),
    onSend: () => state.handleSendChat(),
    canAbort: Boolean(state.chatRunId),
    onAbort: () => void state.handleAbortChat(),
    onQueueRemove: (id) => state.removeQueuedMessage(id),
    showNewMessages: state.chatNewMessagesBelow,
    onScrollToBottom: () => state.scrollToBottom(),
    sidebarOpen: state.sidebarOpen,
    sidebarContent: state.sidebarContent,
    sidebarError: state.sidebarError,
    splitRatio: state.splitRatio,
    onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
    onCloseSidebar: () => state.handleCloseSidebar(),
    onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
    assistantName: state.assistantName,
    assistantAvatar: state.assistantAvatar,
  });
}

function renderWhatsAppScreen(state: MolucaApp) {
  return renderSetupWhatsApp({
    connected: state.connected,
    busy: state.whatsappBusy,
    message: state.whatsappLoginMessage,
    qrDataUrl: state.whatsappLoginQrDataUrl,
    whatsappConnected: state.whatsappLoginConnected,
    status: state.whatsappStatus,
    onStart: (force) => startWhatsApp(state, force),
    onWait: () => waitWhatsApp(state),
    onLogout: () => logoutWhatsApp(state),
    onRefreshStatus: () => loadChannelStatus(state),
    onBack: () => (state.screen = "chat"),
  });
}

function renderTelegramUserScreen(state: MolucaApp) {
  return renderSetupTelegramUser({
    connected: state.connected,
    busy: state.telegramUserBusy,
    step: state.telegramUserStep,
    message: state.telegramUserMessage,
    error: state.telegramUserError,
    apiId: state.telegramUserApiId,
    apiHash: state.telegramUserApiHash,
    phone: state.telegramUserPhone,
    code: state.telegramUserCode,
    password: state.telegramUserPassword,
    status: state.telegramUserStatus,
    onApiIdChange: (next) => (state.telegramUserApiId = next),
    onApiHashChange: (next) => (state.telegramUserApiHash = next),
    onPhoneChange: (next) => (state.telegramUserPhone = next),
    onCodeChange: (next) => (state.telegramUserCode = next),
    onPasswordChange: (next) => (state.telegramUserPassword = next),
    onSendCode: () => sendTelegramUserCode(state),
    onVerifyCode: () => verifyTelegramUserCode(state),
    onVerify2fa: () => verifyTelegramUser2fa(state),
    onLogout: () => logoutTelegramUser(state),
    onRefreshStatus: () => loadChannelStatus(state),
    onRestart: () => {
      state.telegramUserStatus = null;
      state.telegramUserStep = "credentials";
    },
    onBack: () => (state.screen = "chat"),
  });
}

function renderConnectionsModal(state: MolucaApp) {
  if (!state.connectionsModalOpen) return nothing;

  return html`
    <div class="connections-backdrop" @click=${() => (state.connectionsModalOpen = false)}></div>
    <div class="connections-modal">
      <div class="connections-modal__header">
        <h2 class="connections-modal__title">Connections</h2>
        <button class="btn btn--icon btn--sm" title="Close" @click=${() => (state.connectionsModalOpen = false)}>
          ${icons.x}
        </button>
      </div>
      <div class="connections-modal__tabs">
        <button
          class="connections-modal__tab ${state.connectionsModalTab === "whatsapp" ? "connections-modal__tab--active" : ""}"
          @click=${() => (state.connectionsModalTab = "whatsapp")}
        >
          ${icons.whatsapp}
          <span>WhatsApp</span>
        </button>
        <button
          class="connections-modal__tab ${state.connectionsModalTab === "telegram" ? "connections-modal__tab--active" : ""}"
          @click=${() => (state.connectionsModalTab = "telegram")}
        >
          ${icons.telegram}
          <span>Telegram</span>
        </button>
      </div>
      <div class="connections-modal__content">
        ${state.connectionsModalTab === "whatsapp"
          ? renderWhatsAppModalContent(state)
          : renderTelegramModalContent(state)}
      </div>
    </div>
  `;
}

function renderWhatsAppModalContent(state: MolucaApp) {
  const isLinked = state.whatsappStatus?.linked || state.whatsappStatus?.connected;

  return html`
    <div class="connections-modal__section">
      ${!state.connected ? html`<div class="callout">Connect to the gateway first.</div>` : nothing}
      ${isLinked ? renderWhatsAppLinkedContent(state) : renderWhatsAppLoginContent(state)}
    </div>
  `;
}

function renderWhatsAppLinkedContent(state: MolucaApp) {
  const status = state.whatsappStatus!;
  const isRunning = status.running !== false;
  const isConnected = status.connected !== false;

  return html`
    <div class="setup-status">
      <div class="setup-status__indicator ${isConnected ? "setup-status__indicator--ok" : "setup-status__indicator--warn"}">
        <span class="statusDot ${isConnected ? "ok" : ""}"></span>
        <span>${isConnected ? "WhatsApp Connected" : "WhatsApp Linked (offline)"}</span>
      </div>
      ${status.lastError ? html`<div class="callout danger">${status.lastError}</div>` : nothing}
      ${!isRunning ? html`<div class="callout">WhatsApp channel is not running.</div>` : nothing}
    </div>
    ${state.whatsappLoginMessage ? html`<div class="callout info">${state.whatsappLoginMessage}</div>` : nothing}
    <div class="setup-actions">
      <button
        class="btn"
        ?disabled=${!state.connected || state.whatsappBusy}
        @click=${() => loadChannelStatus(state)}
      >
        ${icons.refreshCw} Refresh Status
      </button>
      <button
        class="btn"
        ?disabled=${!state.connected || state.whatsappBusy}
        @click=${() => startWhatsApp(state, true)}
      >
        ${state.whatsappBusy ? "Restarting..." : "Force Relink"}
      </button>
      <button
        class="btn danger"
        ?disabled=${!state.connected || state.whatsappBusy}
        @click=${() => logoutWhatsApp(state)}
      >
        ${state.whatsappBusy ? "Logging out..." : "Logout"}
      </button>
    </div>
  `;
}

function renderWhatsAppLoginContent(state: MolucaApp) {
  return html`
    <p>Connect WhatsApp by scanning the QR code with your phone.</p>
    ${state.whatsappLoginConnected === true
      ? html`<div class="callout success">WhatsApp is connected.</div>`
      : nothing}
    ${state.whatsappLoginQrDataUrl
      ? html`
          <div class="whatsapp-qr">
            <img src=${state.whatsappLoginQrDataUrl} alt="WhatsApp QR Code" class="whatsapp-qr__img" />
          </div>
          <p class="muted">Scan this QR code with WhatsApp on your phone.</p>
          <button class="btn" ?disabled=${state.whatsappBusy} @click=${() => waitWhatsApp(state)}>
            ${state.whatsappBusy ? "Waiting..." : "Check Connection"}
          </button>
        `
      : nothing}
    ${state.whatsappLoginMessage ? html`<div class="callout info">${state.whatsappLoginMessage}</div>` : nothing}
    <div class="setup-actions">
      <button
        class="btn primary"
        ?disabled=${!state.connected || state.whatsappBusy}
        @click=${() => startWhatsApp(state, false)}
      >
        ${state.whatsappBusy ? "Starting..." : "Start WhatsApp Login"}
      </button>
      <button
        class="btn"
        ?disabled=${!state.connected || state.whatsappBusy}
        @click=${() => startWhatsApp(state, true)}
      >
        Force Restart
      </button>
    </div>
  `;
}

function renderTelegramModalContent(state: MolucaApp) {
  const isLinked = state.telegramUserStatus?.linked || state.telegramUserStatus?.connected;

  return html`
    <div class="connections-modal__section">
      ${!state.connected ? html`<div class="callout">Connect to the gateway first.</div>` : nothing}
      ${state.telegramUserError ? html`<div class="callout danger">${state.telegramUserError}</div>` : nothing}
      ${state.telegramUserMessage
        ? html`<div class="callout ${state.telegramUserStep === "done" ? "success" : "info"}">${state.telegramUserMessage}</div>`
        : nothing}
      ${isLinked ? renderTelegramLinkedContent(state) : renderTelegramLoginContent(state)}
    </div>
  `;
}

function renderTelegramLinkedContent(state: MolucaApp) {
  const status = state.telegramUserStatus!;
  const isConnected = status.connected !== false;

  return html`
    <div class="setup-status">
      <div class="setup-status__indicator ${isConnected ? "setup-status__indicator--ok" : "setup-status__indicator--warn"}">
        <span class="statusDot ${isConnected ? "ok" : ""}"></span>
        <span>${isConnected ? "Telegram Connected" : "Telegram Linked (offline)"}</span>
      </div>
      ${status.lastError ? html`<div class="callout danger">${status.lastError}</div>` : nothing}
    </div>
    <div class="setup-actions">
      <button
        class="btn"
        ?disabled=${!state.connected || state.telegramUserBusy}
        @click=${() => loadChannelStatus(state)}
      >
        ${icons.refreshCw} Refresh Status
      </button>
      <button
        class="btn"
        ?disabled=${!state.connected || state.telegramUserBusy}
        @click=${() => {
          state.telegramUserStatus = null;
          state.telegramUserStep = "credentials";
        }}
      >
        Force Relink
      </button>
      <button
        class="btn danger"
        ?disabled=${!state.connected || state.telegramUserBusy}
        @click=${() => logoutTelegramUser(state)}
      >
        ${state.telegramUserBusy ? "Logging out..." : "Logout"}
      </button>
    </div>
  `;
}

function renderTelegramLoginContent(state: MolucaApp) {
  const step = state.telegramUserStep;

  return html`
    ${renderTelegramStepIndicator(step)}
    ${step === "credentials" ? renderTelegramCredentialsContent(state) : nothing}
    ${step === "code" ? renderTelegramCodeContent(state) : nothing}
    ${step === "2fa" ? renderTelegram2faContent(state) : nothing}
    ${step === "done" ? renderTelegramDoneContent(state) : nothing}
  `;
}

function renderTelegramStepIndicator(step: import("./controllers/setup.ts").TelegramUserStep) {
  const steps = [
    { key: "credentials", label: "Credentials" },
    { key: "code", label: "Verify Code" },
    { key: "2fa", label: "2FA" },
  ] as const;

  const currentIdx = steps.findIndex((s) => s.key === step);

  return html`
    <div class="setup-steps">
      ${steps.map(
        (s, i) => html`
          <span class="setup-steps__step ${i <= currentIdx ? "setup-steps__step--active" : ""} ${i < currentIdx ? "setup-steps__step--done" : ""}">
            <span class="setup-steps__num">${i + 1}</span>
            <span class="setup-steps__label">${s.label}</span>
          </span>
          ${i < steps.length - 1 ? html`<span class="setup-steps__sep"></span>` : nothing}
        `,
      )}
    </div>
  `;
}

function renderTelegramCredentialsContent(state: MolucaApp) {
  const canSend =
    state.connected &&
    Boolean(state.telegramUserApiId.trim()) &&
    Boolean(state.telegramUserApiHash.trim()) &&
    Boolean(state.telegramUserPhone.trim());

  return html`
    <p>
      Connect your personal Telegram account via MTProto. Get API credentials from
      <a href="https://my.telegram.org" target="_blank">my.telegram.org</a>.
    </p>
    <label class="field">
      <span>API ID</span>
      <input
        type="text"
        .value=${state.telegramUserApiId}
        @input=${(e: Event) => (state.telegramUserApiId = (e.target as HTMLInputElement).value)}
        placeholder="12345678"
        autocomplete="off"
      />
    </label>
    <label class="field">
      <span>API Hash</span>
      <input
        type="password"
        .value=${state.telegramUserApiHash}
        @input=${(e: Event) => (state.telegramUserApiHash = (e.target as HTMLInputElement).value)}
        placeholder="0123456789abcdef..."
        autocomplete="off"
      />
    </label>
    <label class="field">
      <span>Phone Number</span>
      <input
        type="tel"
        .value=${state.telegramUserPhone}
        @input=${(e: Event) => (state.telegramUserPhone = (e.target as HTMLInputElement).value)}
        placeholder="+1234567890"
        autocomplete="off"
      />
    </label>
    <div class="setup-actions">
      <button
        class="btn primary"
        ?disabled=${!canSend || state.telegramUserBusy}
        @click=${() => sendTelegramUserCode(state)}
      >
        ${state.telegramUserBusy ? "Sending..." : "Send Verification Code"}
      </button>
    </div>
  `;
}

function renderTelegramCodeContent(state: MolucaApp) {
  return html`
    <p>Enter the verification code sent to your Telegram app or via SMS.</p>
    <label class="field">
      <span>Verification Code</span>
      <input
        type="text"
        inputmode="numeric"
        .value=${state.telegramUserCode}
        @input=${(e: Event) => (state.telegramUserCode = (e.target as HTMLInputElement).value)}
        placeholder="12345"
        autocomplete="one-time-code"
      />
    </label>
    <div class="setup-actions">
      <button
        class="btn primary"
        ?disabled=${!state.telegramUserCode.trim() || state.telegramUserBusy}
        @click=${() => verifyTelegramUserCode(state)}
      >
        ${state.telegramUserBusy ? "Verifying..." : "Verify Code"}
      </button>
    </div>
  `;
}

function renderTelegram2faContent(state: MolucaApp) {
  return html`
    <p>Your account has two-factor authentication enabled. Enter your password.</p>
    <label class="field">
      <span>2FA Password</span>
      <input
        type="password"
        .value=${state.telegramUserPassword}
        @input=${(e: Event) => (state.telegramUserPassword = (e.target as HTMLInputElement).value)}
        placeholder="Your 2FA password"
        autocomplete="current-password"
      />
    </label>
    <div class="setup-actions">
      <button
        class="btn primary"
        ?disabled=${!state.telegramUserPassword || state.telegramUserBusy}
        @click=${() => verifyTelegramUser2fa(state)}
      >
        ${state.telegramUserBusy ? "Verifying..." : "Complete Login"}
      </button>
    </div>
  `;
}

function renderTelegramDoneContent(state: MolucaApp) {
  return html`
    <div class="setup-status">
      <div class="setup-status__indicator setup-status__indicator--ok">
        <span class="statusDot ok"></span>
        <span>Telegram Connected</span>
      </div>
    </div>
    <div class="setup-actions">
      <button class="btn" @click=${() => (state.connectionsModalOpen = false)}>Close</button>
    </div>
  `;
}

function renderWorkspaceEditModal(state: MolucaApp) {
  if (!state.workspaceEditModalOpen) return nothing;

  const ws = state as unknown as WorkspaceFileState;
  const activeTab = state.workspaceEditTab;
  const fileName = activeTab === "soul" ? "SOUL.md" : "USER.md";
  const content = activeTab === "soul" ? state.workspaceSoulContent : state.workspaceUserContent;
  const original = activeTab === "soul" ? state.workspaceSoulOriginal : state.workspaceUserOriginal;
  const isDirty = content !== original;

  return html`
    <div class="workspace-backdrop" @click=${() => (state.workspaceEditModalOpen = false)}></div>
    <div class="workspace-modal">
      <div class="workspace-modal__header">
        <h2 class="workspace-modal__title">Customize</h2>
        <button class="btn btn--icon btn--sm" title="Close" @click=${() => (state.workspaceEditModalOpen = false)}>
          ${icons.x}
        </button>
      </div>
      <div class="workspace-modal__tabs">
        <button
          class="workspace-modal__tab ${activeTab === "soul" ? "workspace-modal__tab--active" : ""}"
          @click=${() => {
            state.workspaceEditTab = "soul";
            void loadWorkspaceFile(ws, "SOUL.md");
          }}
        >
          ${icons.sparkles}
          <span>Soul</span>
        </button>
        <button
          class="workspace-modal__tab ${activeTab === "user" ? "workspace-modal__tab--active" : ""}"
          @click=${() => {
            state.workspaceEditTab = "user";
            void loadWorkspaceFile(ws, "USER.md");
          }}
        >
          ${icons.circleUser}
          <span>User</span>
        </button>
      </div>
      <div class="workspace-modal__content">
        ${state.workspaceFileError
          ? html`<div class="workspace-modal__error">${state.workspaceFileError}</div>`
          : nothing}
        ${state.workspaceFileLoading
          ? html`<div class="workspace-modal__loading">Loading ${fileName}...</div>`
          : html`
              <textarea
                class="workspace-modal__textarea"
                .value=${content}
                @input=${(e: Event) => {
                  const val = (e.target as HTMLTextAreaElement).value;
                  if (activeTab === "soul") {
                    state.workspaceSoulContent = val;
                  } else {
                    state.workspaceUserContent = val;
                  }
                }}
                placeholder="Enter content for ${fileName}..."
              ></textarea>
            `}
      </div>
      <div class="workspace-modal__footer">
        <span class="workspace-modal__dirty">
          ${isDirty && !state.workspaceFileLoading ? "Unsaved changes" : ""}
        </span>
        <button
          class="btn primary"
          ?disabled=${!isDirty || state.workspaceFileSaving || state.workspaceFileLoading}
          @click=${() => void saveWorkspaceFile(ws, activeTab === "soul" ? "SOUL.md" : "USER.md", content)}
        >
          ${state.workspaceFileSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  `;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\u2026" : text;
}

function renderSessionsSidebar(state: MolucaApp) {
  const open = state.sessionsSidebarOpen;
  const sessions = state.sessionsResult?.sessions ?? [];

  return html`
    ${open ? html`<div class="sessions-backdrop" @click=${() => (state.sessionsSidebarOpen = false)}></div>` : nothing}
    <aside class="sessions-sidebar ${open ? "sessions-sidebar--open" : ""}">
      <div class="sessions-sidebar__header">
        <span class="sessions-sidebar__title">Sessions</span>
        <button
          class="btn btn--icon btn--sm"
          title="Refresh sessions"
          ?disabled=${state.sessionsLoading}
          @click=${() => void loadSessions(state, { activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES })}
        >
          ${icons.refreshCw}
        </button>
        <button
          class="btn btn--icon btn--sm"
          title="Close"
          @click=${() => (state.sessionsSidebarOpen = false)}
        >
          ${icons.x}
        </button>
      </div>
      <button
        class="sessions-sidebar__new"
        @click=${() => {
          void createNewSession(state, (next) => switchSession(state, next));
          state.sessionsSidebarOpen = false;
        }}
      >
        ${icons.plus}
        <span>New Session</span>
      </button>
      <div class="sessions-sidebar__list">
        ${sessions.length === 0
          ? html`<div class="sessions-sidebar__empty">${state.sessionsLoading ? "Loading\u2026" : "No sessions"}</div>`
          : sessions.map(
              (s) => html`
                <div class="sessions-sidebar__item-row">
                  <button
                    class="sessions-sidebar__item ${s.key === state.sessionKey ? "sessions-sidebar__item--active" : ""}"
                    @click=${() => {
                      switchSession(state, s.key);
                      state.sessionsSidebarOpen = false;
                    }}
                  >
                    <span class="sessions-sidebar__item-label">${truncate(s.label || s.key, 32)}</span>
                    <span class="sessions-sidebar__item-meta">
                      <span>${formatSessionTokens(s)} tok</span>
                      <span>${formatAgo(s.updatedAtMs)}</span>
                    </span>
                  </button>
                  ${s.key !== state.sessionKey
                    ? html`<button
                        class="sessions-sidebar__item-delete"
                        title="Delete session"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          void deleteSession(state, s.key);
                        }}
                      >${icons.x}</button>`
                    : nothing}
                </div>
              `,
            )}
      </div>
    </aside>
  `;
}

function renderInboxButton(state: MolucaApp) {
  return html`
    <button
      class="btn btn--icon inbox-btn ${state.inboxPanelOpen ? "active" : ""}"
      title="Inbox"
      @click=${() => {
        state.inboxPanelOpen = !state.inboxPanelOpen;
        if (state.inboxPanelOpen) {
          void loadInbox(state);
        }
      }}
    >
      ${icons.bell}
      ${state.inboxUnreadCount > 0
        ? html`<span class="inbox-badge">${state.inboxUnreadCount > 9 ? "9+" : state.inboxUnreadCount}</span>`
        : nothing}
    </button>
  `;
}

function renderInboxPanel(state: MolucaApp) {
  const open = state.inboxPanelOpen;
  const entries = state.inboxEntries;

  return html`
    ${open ? html`<div class="inbox-backdrop" @click=${() => (state.inboxPanelOpen = false)}></div>` : nothing}
    <aside class="inbox-panel ${open ? "inbox-panel--open" : ""}">
      <div class="inbox-panel__header">
        <span class="inbox-panel__title">Inbox</span>
        <button
          class="btn btn--icon btn--sm"
          title="Refresh"
          ?disabled=${state.inboxLoading}
          @click=${() => void loadInbox(state)}
        >
          ${icons.refreshCw}
        </button>
        <button
          class="btn btn--icon btn--sm"
          title="Close"
          @click=${() => (state.inboxPanelOpen = false)}
        >
          ${icons.x}
        </button>
      </div>
      <div class="inbox-panel__list">
        ${entries.length === 0
          ? html`<div class="inbox-panel__empty">${state.inboxLoading ? "Loading\u2026" : "No notifications"}</div>`
          : entries.map(
              (entry) => html`
                <div class="inbox-panel__item ${entry.read ? "" : "inbox-panel__item--unread"}">
                  <div class="inbox-panel__item-content">
                    <span class="inbox-panel__item-summary">${entry.summary}</span>
                    <span class="inbox-panel__item-meta">
                      <span>${truncate(entry.sessionKey, 24)}</span>
                      <span>${formatAgo(entry.createdAt)}</span>
                    </span>
                  </div>
                  <div class="inbox-panel__item-actions">
                    <button
                      class="btn btn--icon btn--sm"
                      title="Go to session"
                      @click=${() => {
                        switchSession(state, entry.sessionKey);
                        void markInboxRead(state, [entry.id]);
                        state.inboxPanelOpen = false;
                      }}
                    >
                      ${icons.arrowRight}
                    </button>
                    <button
                      class="btn btn--icon btn--sm inbox-panel__item-dismiss"
                      title="Dismiss"
                      @click=${() => void dismissInboxEntry(state, [entry.id])}
                    >
                      ${icons.x}
                    </button>
                  </div>
                </div>
              `,
            )}
      </div>
    </aside>
  `;
}
