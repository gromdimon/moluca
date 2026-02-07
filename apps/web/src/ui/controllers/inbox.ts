import type { GatewayBrowserClient } from "../gateway.ts";

export type InboxEntry = {
  id: string;
  sessionKey: string;
  summary: string;
  createdAt: number;
  read: boolean;
};

export type InboxState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  inboxEntries: InboxEntry[];
  inboxUnreadCount: number;
  inboxLoading: boolean;
};

export async function loadInbox(state: InboxState) {
  if (!state.client || !state.connected) return;
  if (state.inboxLoading) return;
  state.inboxLoading = true;
  try {
    const res = await state.client.request<{ entries: InboxEntry[]; unreadCount: number } | undefined>(
      "inbox.list",
      {},
    );
    if (res) {
      state.inboxEntries = res.entries;
      state.inboxUnreadCount = res.unreadCount;
    }
  } catch {
    // Silently ignore — inbox is not critical
  } finally {
    state.inboxLoading = false;
  }
}

export async function markInboxRead(state: InboxState, ids: string[]) {
  if (!state.client || !state.connected || ids.length === 0) return;
  try {
    await state.client.request("inbox.markRead", { ids });
  } catch {
    // ignore
  }
}

export async function dismissInboxEntry(state: InboxState, ids: string[]) {
  if (!state.client || !state.connected || ids.length === 0) return;
  try {
    await state.client.request("inbox.dismiss", { ids });
  } catch {
    // ignore
  }
}

type InboxEvent =
  | { type: "new"; entry: InboxEntry }
  | { type: "read"; ids: string[] }
  | { type: "dismiss"; ids: string[] };

export function handleInboxEvent(state: InboxState, payload: unknown) {
  const evt = payload as InboxEvent | undefined;
  if (!evt || !evt.type) return;

  if (evt.type === "new") {
    const entry = evt.entry;
    if (!entry?.id) return;
    state.inboxEntries = [entry, ...state.inboxEntries];
    state.inboxUnreadCount = state.inboxEntries.filter((e) => !e.read).length;
    return;
  }

  if (evt.type === "read") {
    const idSet = new Set(evt.ids);
    state.inboxEntries = state.inboxEntries.map((e) =>
      idSet.has(e.id) ? { ...e, read: true } : e,
    );
    state.inboxUnreadCount = state.inboxEntries.filter((e) => !e.read).length;
    return;
  }

  if (evt.type === "dismiss") {
    const idSet = new Set(evt.ids);
    state.inboxEntries = state.inboxEntries.filter((e) => !idSet.has(e.id));
    state.inboxUnreadCount = state.inboxEntries.filter((e) => !e.read).length;
    return;
  }
}
