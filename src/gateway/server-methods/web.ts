import type { GatewayRequestHandlers } from "./types.js";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import { loadConfig } from "../../config/config.js";
import { resolveWhatsAppAccount } from "../../web/accounts.js";
import { webAuthExists } from "../../web/auth-store.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWebLoginStartParams,
  validateWebLoginWaitParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";

const WEB_LOGIN_METHODS = new Set(["web.login.start", "web.login.wait"]);

const resolveWebLoginProvider = () =>
  listChannelPlugins().find((plugin) =>
    (plugin.gatewayMethods ?? []).some((method) => WEB_LOGIN_METHODS.has(method)),
  ) ?? null;

export const webHandlers: GatewayRequestHandlers = {
  "web.login.start": async ({ params, respond, context }) => {
    if (!validateWebLoginStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.start params: ${formatValidationErrors(validateWebLoginStartParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId =
        typeof (params as { accountId?: unknown }).accountId === "string"
          ? (params as { accountId?: string }).accountId
          : undefined;
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "web login provider is not available"),
        );
        return;
      }
      await context.stopChannel(provider.id, accountId);
      if (!provider.gateway?.loginWithQrStart) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `web login is not supported by provider ${provider.id}`,
          ),
        );
        return;
      }
      const result = await provider.gateway.loginWithQrStart({
        force: Boolean((params as { force?: boolean }).force),
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        verbose: Boolean((params as { verbose?: boolean }).verbose),
        accountId,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "web.login.wait": async ({ params, respond, context }) => {
    if (!validateWebLoginWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.wait params: ${formatValidationErrors(validateWebLoginWaitParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId =
        typeof (params as { accountId?: unknown }).accountId === "string"
          ? (params as { accountId?: string }).accountId
          : undefined;
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "web login provider is not available"),
        );
        return;
      }
      if (!provider.gateway?.loginWithQrWait) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `web login is not supported by provider ${provider.id}`,
          ),
        );
        return;
      }
      const result = await provider.gateway.loginWithQrWait({
        timeoutMs:
          typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
            ? (params as { timeoutMs?: number }).timeoutMs
            : undefined,
        accountId,
      });
      // 515 is normal Baileys post-pairing behavior. If creds were saved, pairing succeeded.
      if (!result.connected && result.message?.includes("515")) {
        const cfg = loadConfig();
        const account = resolveWhatsAppAccount({ cfg, accountId });
        const hasAuth = await webAuthExists(account.authDir);
        if (hasAuth) {
          await context.startChannel(provider.id, accountId);
          respond(
            true,
            { connected: true, message: "WhatsApp is linked. Reconnecting..." },
            undefined,
          );
          return;
        }
      }
      if (result.connected) {
        await context.startChannel(provider.id, accountId);
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
