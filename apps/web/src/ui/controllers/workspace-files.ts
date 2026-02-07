import type { GatewayBrowserClient } from "../gateway.ts";

export type WorkspaceFileState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  assistantAgentId: string | null;
  workspaceEditModalOpen: boolean;
  workspaceEditTab: "soul" | "user";
  workspaceSoulContent: string;
  workspaceSoulOriginal: string;
  workspaceUserContent: string;
  workspaceUserOriginal: string;
  workspaceFileLoading: boolean;
  workspaceFileSaving: boolean;
  workspaceFileError: string | null;
};

export async function loadWorkspaceFile(
  state: WorkspaceFileState,
  name: "SOUL.md" | "USER.md",
) {
  if (!state.client || !state.connected || !state.assistantAgentId) {
    return;
  }
  state.workspaceFileLoading = true;
  state.workspaceFileError = null;
  try {
    const res = await state.client.request<
      { file: { content: string } } | undefined
    >("agents.files.get", { agentId: state.assistantAgentId, name });
    const content = res?.file?.content ?? "";
    if (name === "SOUL.md") {
      state.workspaceSoulContent = content;
      state.workspaceSoulOriginal = content;
    } else {
      state.workspaceUserContent = content;
      state.workspaceUserOriginal = content;
    }
  } catch (err) {
    state.workspaceFileError =
      err instanceof Error ? err.message : "Failed to load file";
  } finally {
    state.workspaceFileLoading = false;
  }
}

export async function saveWorkspaceFile(
  state: WorkspaceFileState,
  name: "SOUL.md" | "USER.md",
  content: string,
) {
  if (!state.client || !state.connected || !state.assistantAgentId) {
    return;
  }
  state.workspaceFileSaving = true;
  state.workspaceFileError = null;
  try {
    await state.client.request("agents.files.set", {
      agentId: state.assistantAgentId,
      name,
      content,
    });
    if (name === "SOUL.md") {
      state.workspaceSoulOriginal = content;
    } else {
      state.workspaceUserOriginal = content;
    }
  } catch (err) {
    state.workspaceFileError =
      err instanceof Error ? err.message : "Failed to save file";
  } finally {
    state.workspaceFileSaving = false;
  }
}
