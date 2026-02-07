import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { callGateway } from "../../gateway/call.js";
import { jsonResult, readStringParam } from "./common.js";

const InboxNotifySchema = Type.Object({
  summary: Type.String({ minLength: 1, maxLength: 500 }),
});

export function createInboxTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Notify User",
    name: "notify_user",
    description:
      "Post a notification to the user's inbox. Use this when you have a finding, alert, or result the user should see. The summary should be a concise one-liner (max 500 chars). The notification links back to this session so the user can find the full context.",
    parameters: InboxNotifySchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const summary = readStringParam(params, "summary", { required: true });
      const result = await callGateway<{ id: string }>({
        method: "inbox.add",
        params: {
          summary,
          sessionKey: opts?.agentSessionKey,
        },
        timeoutMs: 10_000,
      });
      return jsonResult({ status: "ok", id: result?.id, summary });
    },
  };
}
