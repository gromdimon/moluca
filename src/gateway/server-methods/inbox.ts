import type { GatewayRequestHandlers } from "./types.js";
import {
  appendInboxEntry,
  createInboxEntry,
  loadInbox,
  removeInboxEntries,
  resolveInboxStorePath,
  updateInboxEntries,
} from "../inbox-store.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateInboxAddParams,
  validateInboxDismissParams,
  validateInboxListParams,
  validateInboxMarkReadParams,
} from "../protocol/index.js";

export const inboxHandlers: GatewayRequestHandlers = {
  "inbox.list": ({ params, respond }) => {
    if (!validateInboxListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          formatValidationErrors(validateInboxListParams.errors),
        ),
      );
      return;
    }
    const storePath = resolveInboxStorePath();
    const all = loadInbox(storePath);
    const filtered = params.unreadOnly ? all.filter((e) => !e.read) : all;
    const limited = params.limit ? filtered.slice(0, params.limit) : filtered;
    const unreadCount = all.filter((e) => !e.read).length;
    respond(true, { entries: limited, unreadCount });
  },

  "inbox.add": ({ params, respond, context }) => {
    if (!validateInboxAddParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          formatValidationErrors(validateInboxAddParams.errors),
        ),
      );
      return;
    }
    const storePath = resolveInboxStorePath();
    const sessionKey = params.sessionKey ?? "unknown";
    const entry = createInboxEntry(params.summary, sessionKey);
    appendInboxEntry(storePath, entry);
    context.broadcast("inbox", { type: "new", entry });
    respond(true, { id: entry.id });
  },

  "inbox.markRead": ({ params, respond, context }) => {
    if (!validateInboxMarkReadParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          formatValidationErrors(validateInboxMarkReadParams.errors),
        ),
      );
      return;
    }
    const storePath = resolveInboxStorePath();
    updateInboxEntries(storePath, params.ids, (e) => ({ ...e, read: true }));
    context.broadcast("inbox", { type: "read", ids: params.ids });
    respond(true, {});
  },

  "inbox.dismiss": ({ params, respond, context }) => {
    if (!validateInboxDismissParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          formatValidationErrors(validateInboxDismissParams.errors),
        ),
      );
      return;
    }
    const storePath = resolveInboxStorePath();
    removeInboxEntries(storePath, params.ids);
    context.broadcast("inbox", { type: "dismiss", ids: params.ids });
    respond(true, {});
  },
};
