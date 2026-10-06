import type { Estimate, Job, LocalModelCatalog, Project, RegenerationComponent } from "@studio/shared";
import { appConfig } from "./config";
import { demoApi } from "./demo";
import { supabase } from "./supabase";
import { completeVideoSubmission, videoSubmission, type VideoInput } from "./video-submission";

export type VideoResult = {
  id: string;
  url: string;
  thumbnailUrl: string;
  durationMs: number;
  width: number;
  height: number;
};

export type ServiceState = "healthy" | "configured" | "offline" | "disabled" | "unknown";
export type ServiceId = "api" | "supabase" | "openai" | "anthropic" | "ollama" | "localMedia" | "worker" | "render";
export type ServiceStatus = { state: ServiceState; detail: string; checkedAt: string };
export type UsageStats = {
  today: {
    usedUsd: number;
    eventCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  last30Days: { usedUsd: number; eventCount: number; totalTokens: number };
  budgetUsd: number;
  remainingUsd: number;
  budgetPercent: number;
  tokenSource: "estimated" | "recorded";
};

export type AccountSettings = {
  dailyBudgetUsd: number;
  maxConcurrentJobs: number;
  capabilities: {
    supabase: boolean;
    ai: boolean;
    openai: boolean;
    anthropic: boolean;
    ollama: boolean;
    localMedia: boolean;
    render: boolean;
  };
  serviceStatuses: Record<ServiceId, ServiceStatus>;
  usageStats: UsageStats;
};

async function getAuthToken() {
  let token: string | undefined;
  if (supabase) {
    // OAuth can finish before the browser has persisted the session locally.
    // Give the auth client a short grace period so the first dashboard request
    // does not become a misleading unauthenticated/network error.
    for (let attempt = 0; attempt < 4 && !token; attempt += 1) {
      token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  return token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  let response: Response;
  try {
    response = await fetch(`${appConfig.apiUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Không thể kết nối máy chủ. Hãy kiểm tra máy xử lý đang bật rồi thử lại.");
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    details?: Array<{ path?: string; message?: string }>;
  };
  if (!response.ok) {
    const detail = body.details
      ?.map((item) => [item.path, item.message].filter(Boolean).join(": "))
      .filter(Boolean)
      .join("; ");
    throw new Error(
      detail ? `${body.error ?? "Dữ liệu không hợp lệ"}: ${detail}` : body.error ?? "Không thể kết nối máy chủ",
    );
  }
  return body as T;
}

async function voicePreviewBlob(voice: string, engine: string | null): Promise<Blob> {
  const token = await getAuthToken();
  let response: Response;
  try {
    response = await fetch(`${appConfig.apiUrl}/v1/voice-preview`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ voice, engine }),
    });
  } catch {
    throw new Error("Không thể kết nối dịch vụ giọng đọc. Hãy kiểm tra máy xử lý đang bật rồi thử lại.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Chưa nghe thử được giọng đọc");
  }
  return response.blob();
}

async function textToSpeechBlob(text: string, voice: string, engine: string | null, speed: number): Promise<Blob> {
  const token = await getAuthToken();
  let response: Response;
  try {
    response = await fetch(`${appConfig.apiUrl}/v1/text-to-speech`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ text, voice, engine, speed }),
    });
  } catch {
    throw new Error("Không thể kết nối dịch vụ giọng đọc. Hãy kiểm tra máy xử lý đang bật rồi thử lại.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Chưa tạo được giọng đọc");
  }
  return response.blob();
}

export const api = {
  voicePreview: voicePreviewBlob,
  textToSpeech: textToSpeechBlob,
  async createVideo(input: VideoInput) {
    if (appConfig.demoMode) throw new Error("Chế độ mẫu chỉ lưu bản nháp. Tạo video cần kết nối máy xử lý thật.");
    const submission = await videoSubmission(input);
    const { project } = await request<{ project: Project; job: Job }>("/v1/videos", {
      method: "POST",
      headers: { "Idempotency-Key": submission.key },
      body: JSON.stringify(input),
    });
    completeVideoSubmission(submission.storageKey);
    return project;
  },
  async continueVideo(id: string) {
    const { job } = await request<{ project: Project; job: Job }>(`/v1/projects/${id}/continue`, { method: "POST" });
    return job;
  },
  async getResult(id: string): Promise<VideoResult | null> {
    if (appConfig.demoMode) return null;
    const response = await request<{ export: null | Omit<VideoResult, "url"> & { videoUrl: string; downloadUrl: string; createdAt: string }; expiresIn: number }>(`/v1/projects/${id}/result`);
    return response.export ? { ...response.export, url: response.export.videoUrl } : null;
  },
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
  getLocalModels: () => request<LocalModelCatalog>("/v1/local-models"),
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
  regenerateScene: (id: string, sceneId: string, component: RegenerationComponent = "all") =>
    request<Job>(`/v1/projects/${id}/jobs`, {
      method: "POST",
      body: JSON.stringify({ type: "regenerate_scene", payload: { sceneId, component } }),
    }),
  estimate: (id: string) => request<Estimate>(`/v1/projects/${id}/estimate`),
  retryJob: (id: string) =>
    request<Job>(`/v1/jobs/${id}/retry`, { method: "POST" }),
  signedUpload: (
    projectId: string,
    file: File,
    kind: "image" | "audio" | "music" | "logo" | "video",
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
    kind: "image" | "audio" | "music" | "logo" | "video",
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
        kind: "image" | "audio" | "video";
        projectTitle: string;
        url: string;
      }>
    >("/v1/media"),
  exportDownload: (id: string) =>
    request<{ url: string; expiresIn: number }>(`/v1/exports/${id}/download`),
};
