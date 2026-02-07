import { html, nothing } from "lit";

export type ConnectProps = {
  gatewayUrl: string;
  token: string;
  password: string;
  lastError: string | null;
  connecting: boolean;
  onGatewayUrlChange: (next: string) => void;
  onTokenChange: (next: string) => void;
  onPasswordChange: (next: string) => void;
  onConnect: () => void;
};

export function renderConnect(props: ConnectProps) {
  const canConnect = Boolean(props.gatewayUrl.trim());

  return html`
    <section class="connect-screen">
      <div class="connect-card">
        <div class="connect-header">
          <div class="connect-logo">M</div>
          <h1 class="connect-title">Moluca</h1>
          <p class="connect-subtitle">Connect to your Luca gateway</p>
        </div>

        ${props.lastError ? html`<div class="callout danger">${props.lastError}</div>` : nothing}

        <label class="field">
          <span>Gateway URL</span>
          <input
            type="url"
            .value=${props.gatewayUrl}
            @input=${(e: Event) => props.onGatewayUrlChange((e.target as HTMLInputElement).value)}
            placeholder="ws://localhost:18789"
            autocomplete="url"
          />
        </label>

        <label class="field">
          <span>Token (optional)</span>
          <input
            type="password"
            .value=${props.token}
            @input=${(e: Event) => props.onTokenChange((e.target as HTMLInputElement).value)}
            placeholder="Gateway access token"
            autocomplete="current-password"
          />
        </label>

        <label class="field">
          <span>Password (optional)</span>
          <input
            type="password"
            .value=${props.password}
            @input=${(e: Event) => props.onPasswordChange((e.target as HTMLInputElement).value)}
            placeholder="Gateway password"
            autocomplete="off"
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && canConnect) {
                props.onConnect();
              }
            }}
          />
        </label>

        <button
          class="btn primary connect-btn"
          ?disabled=${!canConnect || props.connecting}
          @click=${props.onConnect}
        >
          ${props.connecting ? "Connecting..." : "Connect"}
        </button>
      </div>
    </section>
  `;
}
