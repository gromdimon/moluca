import { html, nothing } from "lit";
import type { ChannelAccountStatus } from "../controllers/setup.ts";
import { icons } from "../icons.ts";

export type SetupWhatsAppProps = {
  connected: boolean;
  busy: boolean;
  message: string | null;
  qrDataUrl: string | null;
  whatsappConnected: boolean | null;
  status: ChannelAccountStatus | null;
  onStart: (force: boolean) => void;
  onWait: () => void;
  onLogout: () => void;
  onRefreshStatus: () => void;
  onBack: () => void;
};

export function renderSetupWhatsApp(props: SetupWhatsAppProps) {
  const isLinked = props.status?.linked || props.status?.connected;

  return html`
    <section class="setup-screen">
      <div class="setup-header">
        <button class="btn" @click=${props.onBack}>${icons.arrowDown} Back</button>
        <h2>WhatsApp Setup</h2>
      </div>

      ${!props.connected ? html`<div class="callout">Connect to the gateway first.</div>` : nothing}

      <div class="setup-card">
        ${isLinked ? renderLinkedState(props) : renderLoginFlow(props)}
      </div>
    </section>
  `;
}

function renderLinkedState(props: SetupWhatsAppProps) {
  const status = props.status!;
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

    ${props.message ? html`<div class="callout info">${props.message}</div>` : nothing}

    <div class="setup-actions">
      <button
        class="btn"
        ?disabled=${!props.connected || props.busy}
        @click=${() => props.onRefreshStatus()}
      >
        ${icons.refreshCw} Refresh Status
      </button>
      <button
        class="btn"
        ?disabled=${!props.connected || props.busy}
        @click=${() => props.onStart(true)}
      >
        ${props.busy ? "Restarting..." : "Force Relink"}
      </button>
      <button
        class="btn danger"
        ?disabled=${!props.connected || props.busy}
        @click=${() => props.onLogout()}
      >
        ${props.busy ? "Logging out..." : "Logout"}
      </button>
    </div>
  `;
}

function renderLoginFlow(props: SetupWhatsAppProps) {
  return html`
    <p>Connect WhatsApp by scanning the QR code with your phone.</p>

    ${
      props.whatsappConnected === true
        ? html`<div class="callout success">WhatsApp is connected.</div>`
        : nothing
    }

    ${
      props.qrDataUrl
        ? html`
          <div class="whatsapp-qr">
            <img src=${props.qrDataUrl} alt="WhatsApp QR Code" class="whatsapp-qr__img" />
          </div>
          <p class="muted">Scan this QR code with WhatsApp on your phone.</p>
          <button class="btn" ?disabled=${props.busy} @click=${() => props.onWait()}>
            ${props.busy ? "Waiting..." : "Check Connection"}
          </button>
        `
        : nothing
    }

    ${props.message ? html`<div class="callout info">${props.message}</div>` : nothing}

    <div class="setup-actions">
      <button
        class="btn primary"
        ?disabled=${!props.connected || props.busy}
        @click=${() => props.onStart(false)}
      >
        ${props.busy ? "Starting..." : "Start WhatsApp Login"}
      </button>
      <button
        class="btn"
        ?disabled=${!props.connected || props.busy}
        @click=${() => props.onStart(true)}
      >
        Force Restart
      </button>
    </div>
  `;
}
