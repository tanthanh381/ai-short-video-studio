import type { Estimate, Job, Project } from "@studio/shared";
import { appConfig } from "./config";
import { demoApi } from "./demo";
import { supabase } from "./supabase";

export type AccountSettings = {
  dailyBudgetUsd: number;
  maxConcurrentJobs: number;
  capabilities: {
    supabase: boolean;
    ai: boolean;
    openai: boolean;
    anthropic: boolean;
    render: boolean;
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  const response = await fetch(`${appConfig.apiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Không thể kết nối máy chủ");
  return body as T;
}

export const api = {
  listProjects: () =>
    appConfig.demoMode
      ? demoApi.listProjects()
      : request<Project[]>("/v1/projects"),
  getProject: (id: string) =>
    appConfig.demoMode
      ? demoApi.getProject(id)
      : request<Project>(`/v1/projects/${id}`),
  createProject: (
    input: Pick<Project, "title" | "sourceText" | "inputMode" | "settings">,
  ) =>
    appConfig.demoMode
      ? demoApi.createProject(input)
      : request<Project>("/v1/projects", {
          method: "POST",
          body: JSON.stringify(input),
        }),
  updateProject: (project: Project) =>
    appConfig.demoMode
      ? demoApi.updateProject(project)
      : request<Project>(`/v1/projects/${project.id}`, {
          method: "PUT",
          body: JSON.stringify(project),
        }),
  deleteProject: (id: string) =>
    appConfig.demoMode
      ? demoApi.deleteProject(id)
      : request<void>(`/v1/projects/${id}`, { method: "DELETE" }),
  duplicateProject: (id: string) =>
    appConfig.demoMode
      ? demoApi.duplicateProject(id)
      : request<Project>(`/v1/projects/${id}/duplicate`, { method: "POST" }),
  getJobs: (id: string) =>
    appConfig.demoMode
      ? demoApi.getJobs(id)
      : request<Job[]>(`/v1/projects/${id}/jobs`),
  getSettings: () => request<AccountSettings>("/v1/settings"),
  updateSettings: (
    input: Pick<AccountSettings, "dailyBudgetUsd" | "maxConcurrentJobs">,
  ) =>
    request<AccountSettings>("/v1/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  queue: (
    id: string,
    type: "storyboard" | "generate_media" | "render_video",
    payload: object = {},
  ) =>
    request<Job>(`/v1/projects/${id}/jobs`, {
      method: "POST",
      body: JSON.stringify({ type, payload }),
    }),
  regenerateScene: (id: string, sceneId: string) =>
    request<Job>(`/v1/projects/${id}/jobs`, {
      method: "POST",
      body: JSON.stringify({ type: "regenerate_scene", payload: { sceneId } }),
    }),
  estimate: (id: string) => request<Estimate>(`/v1/projects/${id}/estimate`),
  retryJob: (id: string) =>
    request<Job>(`/v1/jobs/${id}/retry`, { method: "POST" }),
  signedUpload: (
    projectId: string,
    file: File,
    kind: "image" | "audio" | "music",
  ) =>
    request<{ token: string; path: string }>(
      `/v1/projects/${projectId}/uploads/sign`,
      {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          size: file.size,
          kind,
        }),
      },
    ),
  async uploadMedia(
    projectId: string,
    file: File,
    kind: "image" | "audio" | "music",
  ) {
    if (!supabase) throw new Error("Chưa kết nối kho media");
    const signed = await this.signedUpload(projectId, file, kind);
    const { error } = await supabase.storage
      .from("private-media")
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType: file.type,
      });
    if (error) throw new Error(error.message);
    return signed.path;
  },
  mediaUrl: (projectId: string, path: string) =>
    request<{ url: string; expiresIn: number }>(
      `/v1/projects/${projectId}/media/sign`,
      { method: "POST", body: JSON.stringify({ path }) },
    ),
  listExports: () =>
    request<
      Array<{
        id: string;
        projectTitle: string;
        durationMs: number;
        width: number;
        height: number;
        createdAt: string;
        thumbnailUrl: string;
      }>
    >("/v1/exports"),
  listMedia: () =>
    request<
      Array<{
        id: string;
        kind: "image" | "audio";
        projectTitle: string;
        url: string;
      }>
    >("/v1/media"),
  exportDownload: (id: string) =>
    request<{ url: string; expiresIn: number }>(`/v1/exports/${id}/download`),
};
