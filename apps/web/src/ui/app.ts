import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { SessionsListResult } from "./types.ts";
import type { InboxEntry } from "./controllers/inbox.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";
import type { Screen } from "./app-render.ts";
import type { CompactionStatus, ToolStreamEntry } from "./app-tool-stream.ts";
import type { ResolvedTheme, ThemeMode } from "./theme.ts";
import {
  handleAbortChat as handleAbortChatInternal,
  handleSendChat as handleSendChatInternal,
  removeQueuedMessage as removeQueuedMessageInternal,
} from "./app-chat.ts";
import { connectGateway as connectGatewayInternal } from "./app-gateway.ts";
import { renderApp } from "./app-render.ts";
import {
  handleChatScroll as handleChatScrollInternal,
  resetChatScroll as resetChatScrollInternal,
  scheduleChatScroll as scheduleChatScrollInternal,
} from "./app-scroll.ts";
import {
  resetToolStream as resetToolStreamInternal,
} from "./app-tool-stream.ts";
import { resolveInjectedAssistantIdentity } from "./assistant-identity.ts";
import { loadAssistantIdentity as loadAssistantIdentityInternal } from "./controllers/assistant-identity.ts";
import { loadSettings, saveSettings, type UiSettings } from "./storage.ts";
import { resolveTheme, getSystemTheme } from "./theme.ts";

const injectedAssistantIdentity = resolveInjectedAssistantIdentity();

@customElement("moluca-app")
export class MolucaApp extends LitElement {
  @state() settings: UiSettings = loadSettings();
  @state() password = "";
  @state() screen: Screen = this.settings.gatewayUrl ? "connect" : "connect";
  @state() connected = false;
  @state() theme: ThemeMode = this.settings.theme ?? "system";
  @state() themeResolved: ResolvedTheme = "dark";
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;

  @state() assistantName = injectedAssistantIdentity.name;
  @state() assistantAvatar = injectedAssistantIdentity.avatar;
  @state() assistantAgentId = injectedAssistantIdentity.agentId ?? null;

  @state() sessionKey = this.settings.sessionKey;
  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  @state() chatToolMessages: unknown[] = [];
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;
  @state() chatRunId: string | null = null;
  @state() compactionStatus: CompactionStatus | null = null;
  @state() chatAvatarUrl: string | null = null;
  @state() chatThinkingLevel: string | null = null;
  @state() chatQueue: ChatQueueItem[] = [];
  @state() chatAttachments: ChatAttachment[] = [];

  @state() sidebarOpen = false;
  @state() sidebarContent: string | null = null;
  @state() sidebarError: string | null = null;
  @state() splitRatio = this.settings.splitRatio;

  @state() sessionsSidebarOpen = false;

  // Inbox state
  @state() inboxEntries: InboxEntry[] = [];
  @state() inboxUnreadCount = 0;
  @state() inboxLoading = false;
  @state() inboxPanelOpen = false;

  @state() sessionsLoading = false;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() sessionsError: string | null = null;
  @state() sessionsFilterActive = "";
  @state() sessionsFilterLimit = "120";
  @state() sessionsIncludeGlobal = true;
  @state() sessionsIncludeUnknown = false;

  // WhatsApp setup state
  @state() whatsappBusy = false;
  @state() whatsappLoginMessage: string | null = null;
  @state() whatsappLoginQrDataUrl: string | null = null;
  @state() whatsappLoginConnected: boolean | null = null;
  @state() whatsappStatus: import("./controllers/setup.ts").ChannelAccountStatus | null = null;

  // Telegram User (MTProto) setup state
  @state() telegramUserBusy = false;
  @state() telegramUserStep: import("./controllers/setup.ts").TelegramUserStep = "credentials";
  @state() telegramUserMessage: string | null = null;
  @state() telegramUserError: string | null = null;
  @state() telegramUserApiId = "";
  @state() telegramUserApiHash = "";
  @state() telegramUserPhone = "";
  @state() telegramUserCode = "";
  @state() telegramUserPassword = "";
  @state() telegramUserStatus: import("./controllers/setup.ts").ChannelAccountStatus | null = null;

  // Connections modal state
  @state() connectionsModalOpen = false;
  @state() connectionsModalTab: "whatsapp" | "telegram" = "whatsapp";

  // Workspace file editor state
  @state() workspaceEditModalOpen = false;
  @state() workspaceEditTab: "soul" | "user" = "soul";
  @state() workspaceSoulContent = "";
  @state() workspaceSoulOriginal = "";
  @state() workspaceUserContent = "";
  @state() workspaceUserOriginal = "";
  @state() workspaceFileLoading = false;
  @state() workspaceFileSaving = false;
  @state() workspaceFileError: string | null = null;

  // Settings dropdown state
  @state() settingsDropdownOpen = false;

  @state() chatNewMessagesBelow = false;

  client: GatewayBrowserClient | null = null;
  private chatScrollFrame: number | null = null;
  private chatScrollTimeout: number | null = null;
  private chatHasAutoScrolled = false;
  private chatUserNearBottom = true;
  private sidebarCloseTimer: number | null = null;
  private toolStreamById = new Map<string, ToolStreamEntry>();
  private toolStreamOrder: string[] = [];
  private toolStreamSyncTimer: number | null = null;
  refreshSessionsAfterChat = new Set<string>();
  // Needed by app-scroll but unused in this simplified app
  private logsScrollFrame: number | null = null;
  private logsAtBottom = true;
  private topbarObserver: ResizeObserver | null = null;

  private themeMedia: MediaQueryList | null = null;
  private themeMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.themeResolved = resolveTheme(this.theme);
    document.documentElement.setAttribute("data-theme", this.themeResolved);
    this.themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    this.themeMediaHandler = () => {
      if (this.theme === "system") {
        this.themeResolved = getSystemTheme();
        document.documentElement.setAttribute("data-theme", this.themeResolved);
      }
    };
    this.themeMedia.addEventListener("change", this.themeMediaHandler);

    // Auto-connect if we have a saved gateway URL
    if (this.settings.gatewayUrl) {
      this.connect();
    }
  }

  disconnectedCallback() {
    if (this.themeMedia && this.themeMediaHandler) {
      this.themeMedia.removeEventListener("change", this.themeMediaHandler);
    }
    this.client?.stop();
    super.disconnectedCallback();
  }

  connect() {
    if (!this.settings.gatewayUrl) {
      return;
    }
    connectGatewayInternal(this as unknown as Parameters<typeof connectGatewayInternal>[0]);
    this.screen = "chat";
  }

  setTheme(next: ThemeMode) {
    this.theme = next;
    this.themeResolved = resolveTheme(next);
    document.documentElement.setAttribute("data-theme", this.themeResolved);
    this.applySettings({ ...this.settings, theme: next });
  }

  applySettings(next: UiSettings) {
    this.settings = next;
    saveSettings(next);
  }

  handleChatScroll(event: Event) {
    handleChatScrollInternal(
      this as unknown as Parameters<typeof handleChatScrollInternal>[0],
      event,
    );
  }

  resetToolStream() {
    resetToolStreamInternal(this as unknown as Parameters<typeof resetToolStreamInternal>[0]);
  }

  resetChatScroll() {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
  }

  scrollToBottom() {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
    scheduleChatScrollInternal(
      this as unknown as Parameters<typeof scheduleChatScrollInternal>[0],
      true,
    );
  }

  async loadAssistantIdentity() {
    await loadAssistantIdentityInternal(this);
  }

  async handleAbortChat() {
    await handleAbortChatInternal(this as unknown as Parameters<typeof handleAbortChatInternal>[0]);
  }

  removeQueuedMessage(id: string) {
    removeQueuedMessageInternal(
      this as unknown as Parameters<typeof removeQueuedMessageInternal>[0],
      id,
    );
  }

  async handleSendChat(
    messageOverride?: string,
    opts?: Parameters<typeof handleSendChatInternal>[2],
  ) {
    await handleSendChatInternal(
      this as unknown as Parameters<typeof handleSendChatInternal>[0],
      messageOverride,
      opts,
    );
  }

  toggleSessionsSidebar() {
    this.sessionsSidebarOpen = !this.sessionsSidebarOpen;
  }

  handleOpenSidebar(content: string) {
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarContent = content;
    this.sidebarError = null;
    this.sidebarOpen = true;
  }

  handleCloseSidebar() {
    this.sidebarOpen = false;
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
    }
    this.sidebarCloseTimer = window.setTimeout(() => {
      if (this.sidebarOpen) {
        return;
      }
      this.sidebarContent = null;
      this.sidebarError = null;
      this.sidebarCloseTimer = null;
    }, 200);
  }

  handleSplitRatioChange(ratio: number) {
    const newRatio = Math.max(0.4, Math.min(0.7, ratio));
    this.splitRatio = newRatio;
    this.applySettings({ ...this.settings, splitRatio: newRatio });
  }

  render() {
    return renderApp(this);
  }
}
