import { html, nothing } from "lit";
import type { ChannelAccountStatus } from "../controllers/setup.ts";
import { icons } from "../icons.ts";

export type SetupTelegramProps = {
  connected: boolean;
  busy: boolean;
  botToken: string;
  message: string | null;
  error: string | null;
  status: ChannelAccountStatus | null;
  onBotTokenChange: (next: string) => void;
  onSave: () => void;
  onBack: () => void;
};

export function renderSetupTelegram(props: SetupTelegramProps) {
  const canSave = props.connected && Boolean(props.botToken.trim());
  const isLinked = props.status?.linked || props.status?.connected;

  return html`
    <section class="setup-screen">
      <div class="setup-header">
        <button class="btn" @click=${props.onBack}>${icons.arrowDown} Back</button>
        <h2>Telegram Setup</h2>
      </div>

      ${!props.connected ? html`<div class="callout">Connect to the gateway first.</div>` : nothing}

      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
      ${props.message ? html`<div class="callout success">${props.message}</div>` : nothing}

      ${isLinked ? renderLinkedStatus(props) : nothing}

      <div class="setup-card">
        <p>Configure your Telegram bot token. Get one from <a href="https://t.me/BotFather" target="_blank">@BotFather</a>.</p>

        <label class="field">
          <span>Bot Token</span>
          <input
            type="password"
            .value=${props.botToken}
            @input=${(e: Event) => props.onBotTokenChange((e.target as HTMLInputElement).value)}
            placeholder="123456:ABC-DEF1234..."
            autocomplete="off"
          />
        </label>

        <div class="setup-actions">
          <button
            class="btn primary"
            ?disabled=${!canSave || props.busy}
            @click=${props.onSave}
          >
            ${props.busy ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderLinkedStatus(props: SetupTelegramProps) {
  const status = props.status!;
  const isConnected = status.connected !== false;

  return html`
    <div class="setup-card">
      <div class="setup-status">
        <div class="setup-status__indicator ${isConnected ? "setup-status__indicator--ok" : "setup-status__indicator--warn"}">
          <span class="statusDot ${isConnected ? "ok" : ""}"></span>
          <span>${isConnected ? "Telegram Bot Connected" : "Telegram Bot Linked (offline)"}</span>
        </div>
        ${status.lastError ? html`<div class="callout danger">${status.lastError}</div>` : nothing}
      </div>
    </div>
  `;
}
