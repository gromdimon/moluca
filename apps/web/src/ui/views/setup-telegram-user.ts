import { html, nothing } from "lit";
import type { ChannelAccountStatus, TelegramUserStep } from "../controllers/setup.ts";
import { icons } from "../icons.ts";

export type SetupTelegramUserProps = {
  connected: boolean;
  busy: boolean;
  step: TelegramUserStep;
  message: string | null;
  error: string | null;
  apiId: string;
  apiHash: string;
  phone: string;
  code: string;
  password: string;
  status: ChannelAccountStatus | null;
  onApiIdChange: (next: string) => void;
  onApiHashChange: (next: string) => void;
  onPhoneChange: (next: string) => void;
  onCodeChange: (next: string) => void;
  onPasswordChange: (next: string) => void;
  onSendCode: () => void;
  onVerifyCode: () => void;
  onVerify2fa: () => void;
  onLogout: () => void;
  onRefreshStatus: () => void;
  onRestart: () => void;
  onBack: () => void;
};

export function renderSetupTelegramUser(props: SetupTelegramUserProps) {
  const isLinked = props.status?.linked || props.status?.connected;

  return html`
    <section class="setup-screen">
      <div class="setup-header">
        <button class="btn" @click=${props.onBack}>${icons.arrowDown} Back</button>
        <h2>Telegram Personal</h2>
      </div>

      ${!props.connected ? html`<div class="callout">Connect to the gateway first.</div>` : nothing}
      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
      ${props.message ? html`<div class="callout ${props.step === "done" ? "success" : "info"}">${props.message}</div>` : nothing}

      <div class="setup-card">
        ${isLinked ? renderLinkedState(props) : renderLoginFlow(props)}
      </div>
    </section>
  `;
}

function renderLinkedState(props: SetupTelegramUserProps) {
  const status = props.status!;
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
        ?disabled=${!props.connected || props.busy}
        @click=${() => props.onRefreshStatus()}
      >
        ${icons.refreshCw} Refresh Status
      </button>
      <button
        class="btn"
        ?disabled=${!props.connected || props.busy}
        @click=${() => props.onRestart()}
      >
        Force Relink
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

function renderLoginFlow(props: SetupTelegramUserProps) {
  const step = props.step;

  return html`
    ${renderStepIndicator(step)}
    ${step === "credentials" ? renderCredentialsStep(props) : nothing}
    ${step === "code" ? renderCodeStep(props) : nothing}
    ${step === "2fa" ? render2faStep(props) : nothing}
    ${step === "done" ? renderDoneStep(props) : nothing}
  `;
}

function renderStepIndicator(step: TelegramUserStep) {
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

function renderCredentialsStep(props: SetupTelegramUserProps) {
  const canSend =
    props.connected &&
    Boolean(props.apiId.trim()) &&
    Boolean(props.apiHash.trim()) &&
    Boolean(props.phone.trim());

  return html`
    <p>
      Connect your personal Telegram account via MTProto. Get API credentials from
      <a href="https://my.telegram.org" target="_blank">my.telegram.org</a>.
    </p>

    <label class="field">
      <span>API ID</span>
      <input
        type="text"
        .value=${props.apiId}
        @input=${(e: Event) => props.onApiIdChange((e.target as HTMLInputElement).value)}
        placeholder="12345678"
        autocomplete="off"
      />
    </label>

    <label class="field">
      <span>API Hash</span>
      <input
        type="password"
        .value=${props.apiHash}
        @input=${(e: Event) => props.onApiHashChange((e.target as HTMLInputElement).value)}
        placeholder="0123456789abcdef..."
        autocomplete="off"
      />
    </label>

    <label class="field">
      <span>Phone Number</span>
      <input
        type="tel"
        .value=${props.phone}
        @input=${(e: Event) => props.onPhoneChange((e.target as HTMLInputElement).value)}
        placeholder="+1234567890"
        autocomplete="off"
      />
    </label>

    <div class="setup-actions">
      <button
        class="btn primary"
        ?disabled=${!canSend || props.busy}
        @click=${props.onSendCode}
      >
        ${props.busy ? "Sending..." : "Send Verification Code"}
      </button>
    </div>
  `;
}

function renderCodeStep(props: SetupTelegramUserProps) {
  return html`
    <p>Enter the verification code sent to your Telegram app or via SMS.</p>

    <label class="field">
      <span>Verification Code</span>
      <input
        type="text"
        inputmode="numeric"
        .value=${props.code}
        @input=${(e: Event) => props.onCodeChange((e.target as HTMLInputElement).value)}
        placeholder="12345"
        autocomplete="one-time-code"
      />
    </label>

    <div class="setup-actions">
      <button
        class="btn primary"
        ?disabled=${!props.code.trim() || props.busy}
        @click=${props.onVerifyCode}
      >
        ${props.busy ? "Verifying..." : "Verify Code"}
      </button>
    </div>
  `;
}

function render2faStep(props: SetupTelegramUserProps) {
  return html`
    <p>Your account has two-factor authentication enabled. Enter your password.</p>

    <label class="field">
      <span>2FA Password</span>
      <input
        type="password"
        .value=${props.password}
        @input=${(e: Event) => props.onPasswordChange((e.target as HTMLInputElement).value)}
        placeholder="Your 2FA password"
        autocomplete="current-password"
      />
    </label>

    <div class="setup-actions">
      <button
        class="btn primary"
        ?disabled=${!props.password || props.busy}
        @click=${props.onVerify2fa}
      >
        ${props.busy ? "Verifying..." : "Complete Login"}
      </button>
    </div>
  `;
}

function renderDoneStep(props: SetupTelegramUserProps) {
  return html`
    <div class="setup-status">
      <div class="setup-status__indicator setup-status__indicator--ok">
        <span class="statusDot ok"></span>
        <span>Telegram Connected</span>
      </div>
    </div>
    <div class="setup-actions">
      <button class="btn" @click=${props.onBack}>Go to Chat</button>
    </div>
  `;
}
