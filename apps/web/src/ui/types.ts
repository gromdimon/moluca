/** Minimal type definitions for the Moluca web app. */

export type SessionsListResult = {
  count?: number;
  sessions?: GatewaySessionRow[];
};

export type GatewaySessionRow = {
  key: string;
  label?: string;
  reasoningLevel?: string;
  totalTokens?: number;
  contextTokens?: number;
  updatedAtMs?: number;
};
