import type { GatewaySessionRow } from "./types.ts";

export function formatSessionTokens(row: GatewaySessionRow) {
  if (row.totalTokens == null) {
    return "n/a";
  }
  const total = row.totalTokens ?? 0;
  const ctx = row.contextTokens ?? 0;
  return ctx ? `${total} / ${ctx}` : String(total);
}
