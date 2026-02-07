import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../routing/session-key.js";

export type InboxEntry = {
  id: string;
  sessionKey: string;
  summary: string;
  createdAt: number;
  read: boolean;
};

export function resolveInboxStorePath(agentId?: string): string {
  const root = resolveStateDir();
  const id = normalizeAgentId(agentId ?? DEFAULT_AGENT_ID);
  return path.join(root, "agents", id, "sessions", "inbox.json");
}

export function loadInbox(storePath: string): InboxEntry[] {
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveInbox(storePath: string, entries: InboxEntry[]): void {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(storePath, JSON.stringify(entries, null, 2), "utf-8");
}

export function createInboxEntry(summary: string, sessionKey: string): InboxEntry {
  return {
    id: randomUUID(),
    sessionKey,
    summary,
    createdAt: Date.now(),
    read: false,
  };
}

export function appendInboxEntry(storePath: string, entry: InboxEntry): void {
  const entries = loadInbox(storePath);
  entries.unshift(entry);
  saveInbox(storePath, entries);
}

export function updateInboxEntries(
  storePath: string,
  ids: string[],
  updater: (entry: InboxEntry) => InboxEntry,
): void {
  const idSet = new Set(ids);
  const entries = loadInbox(storePath);
  const updated = entries.map((e) => (idSet.has(e.id) ? updater(e) : e));
  saveInbox(storePath, updated);
}

export function removeInboxEntries(storePath: string, ids: string[]): void {
  const idSet = new Set(ids);
  const entries = loadInbox(storePath);
  const filtered = entries.filter((e) => !idSet.has(e.id));
  saveInbox(storePath, filtered);
}
