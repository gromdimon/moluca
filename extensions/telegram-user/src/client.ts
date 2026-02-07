import type { Entity } from "telegram/define";
import { TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { StringSession } from "telegram/sessions";

export type TelegramUserClientOptions = {
  apiId: number;
  apiHash: string;
  sessionString?: string;
  connectionRetries?: number;
};

export type TelegramUserMessageHandler = (event: NewMessageEvent) => void | Promise<void>;

/**
 * Wraps the GramJS TelegramClient for user-account (MTProto) messaging.
 */
export class GramJSClient {
  private client: TelegramClient;
  private session: StringSession;
  private apiId: number;
  private apiHash: string;
  private connected = false;

  constructor(options: TelegramUserClientOptions) {
    this.apiId = options.apiId;
    this.apiHash = options.apiHash;
    this.session = new StringSession(options.sessionString ?? "");
    this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {
      connectionRetries: options.connectionRetries ?? 5,
    });
  }

  /**
   * Connect to Telegram using a saved session string (no interactive auth).
   * Throws if the session is invalid/expired.
   */
  async connect(): Promise<void> {
    await this.client.connect();
    this.connected = true;
  }

  /**
   * Interactive login flow for initial authentication.
   * Requires callbacks for phone number, code, and optional 2FA password.
   */
  async startInteractive(params: {
    phoneNumber: () => Promise<string>;
    phoneCode: () => Promise<string>;
    password: () => Promise<string>;
    onError: (err: Error) => void;
  }): Promise<void> {
    await this.client.start({
      phoneNumber: params.phoneNumber,
      phoneCode: params.phoneCode,
      password: params.password,
      onError: params.onError,
    });
    this.connected = true;
  }

  /**
   * Save the current session string for future reconnection.
   */
  saveSession(): string {
    // StringSession.save() returns the session as a string.
    return this.session.save() as unknown as string;
  }

  /**
   * Disconnect from Telegram.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    try {
      await this.client.disconnect();
    } finally {
      this.connected = false;
    }
  }

  /**
   * Check if the client is connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send a text message to a chat/user.
   * @param target - username, phone number, or chat ID
   * @param text - message text
   */
  async sendMessage(target: string, text: string): Promise<{ messageId: number }> {
    const result = await this.client.sendMessage(target, { message: text });
    return { messageId: result.id };
  }

  /**
   * Send a file/media to a chat/user.
   * @param target - username, phone number, or chat ID
   * @param filePath - URL or local path to media
   * @param caption - optional caption
   */
  async sendFile(
    target: string,
    filePath: string,
    caption?: string,
  ): Promise<{ messageId: number }> {
    const result = await this.client.sendFile(target, {
      file: filePath,
      caption,
    });
    return { messageId: result.id };
  }

  /**
   * Register a handler for incoming messages.
   */
  addMessageHandler(handler: TelegramUserMessageHandler): void {
    this.client.addEventHandler(handler, new NewMessage({}));
  }

  /**
   * Get information about the currently logged-in user.
   */
  async getMe(): Promise<Entity | undefined> {
    return await this.client.getMe();
  }

  /**
   * Fetch message history from a chat/user.
   * @param target - username, phone number, or chat ID
   * @param opts - optional limit and offsetId for pagination
   */
  async getMessages(
    target: string,
    opts?: { limit?: number; offsetId?: number },
  ): Promise<Array<{ id: number; message: string; date: number; fromId?: string; out: boolean }>> {
    const messages = await this.client.getMessages(target, {
      limit: opts?.limit ?? 20,
      offsetId: opts?.offsetId,
    });
    return messages.map((msg) => {
      let fromId: string | undefined;
      if (msg.fromId) {
        const peer = msg.fromId as { userId?: bigint | number };
        fromId = peer.userId != null ? String(peer.userId) : JSON.stringify(msg.fromId);
      }
      return {
        id: msg.id,
        message: msg.message ?? "",
        date: msg.date ?? 0,
        fromId,
        out: Boolean(msg.out),
      };
    });
  }

  /**
   * Get the underlying TelegramClient (for advanced operations).
   */
  getUnderlyingClient(): TelegramClient {
    return this.client;
  }
}
