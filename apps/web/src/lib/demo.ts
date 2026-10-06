import {
  DEFAULT_PROJECT_SETTINGS,
  type Job,
  type Project,
  type Scene,
} from "@studio/shared";

const STORAGE_KEY = "ai-short-video-studio-projects-v1";
const DEMO_USER = "00000000-0000-4000-8000-000000000001";

function sampleProject(): Project {
  const now = new Date().toISOString();
  const scenes: Scene[] = [
    {
      id: crypto.randomUUID(),
      order: 0,
      narration: "Có những lúc, đi chậm lại không phải là tụt phía sau.",
      imagePrompt:
        "Một người Việt trẻ đứng bên cửa sổ lúc bình minh, ánh sáng dịu, minh họa điện ảnh, khung dọc",
      estimatedDurationMs: 6500,
      actualDurationMs: null,
      imagePath: null,
      videoPath: null,
      audioPath: null,
      thumbnailUrl: null,
      mediaStatus: "pending",
      errorMessage: null,
      subtitles: [],
    },
    {
      id: crypto.randomUUID(),
      order: 1,
      narration:
        "Đó là lúc ta đủ tĩnh để nhìn thấy điều gì thật sự quan trọng.",
      imagePrompt:
        "Con đường nhỏ qua cánh đồng Việt Nam trong sương sớm, không khí bình yên, khung dọc",
      estimatedDurationMs: 7500,
      actualDurationMs: null,
      imagePath: null,
      videoPath: null,
      audioPath: null,
      thumbnailUrl: null,
      mediaStatus: "pending",
      errorMessage: null,
      subtitles: [],
    },
    {
      id: crypto.randomUUID(),
      order: 2,
      narration: "Một phút thở sâu hôm nay có thể cứu cả một ngày vội vã.",
      imagePrompt:
        "Tách trà bốc khói trên bàn gỗ, nắng sớm, bàn tay nghỉ ngơi, cảm giác chữa lành, khung dọc",
      estimatedDurationMs: 6500,
      actualDurationMs: null,
      imagePath: null,
      videoPath: null,
      audioPath: null,
      thumbnailUrl: null,
      mediaStatus: "pending",
      errorMessage: null,
      subtitles: [],
    },
  ];
  return {
    id: "10000000-0000-4000-8000-000000000001",
    userId: DEMO_USER,
    title: "Một phút sống chậm — dự án mẫu",
    sourceText:
      "Một video ngắn nhắc người xem dừng lại, thở sâu và trân trọng điều đang có.",
    inputMode: "idea",
    hook: "Đi chậm lại có thật sự là tụt phía sau?",
    suggestedTitle: "Một phút sống chậm",
    suggestedDescription:
      "Đôi khi điều ta cần không phải là đi nhanh hơn, mà là nhìn rõ hơn.",
    status: "draft",
    settings: DEFAULT_PROJECT_SETTINGS,
    scenes,
    createdAt: now,
    updatedAt: now,
  };
}

function read(): Project[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = [sampleProject()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
  try {
    return JSON.parse(raw) as Project[];
  } catch {
    return [sampleProject()];
  }
}

function write(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export const demoApi = {
  async listProjects(): Promise<Project[]> {
    return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async getProject(id: string): Promise<Project> {
    const project = read().find((item) => item.id === id);
    if (!project) throw new Error("Không tìm thấy dự án");
    return project;
  },
  async createProject(
    input: Pick<Project, "title" | "sourceText" | "inputMode" | "settings">,
  ): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      userId: DEMO_USER,
      title: input.title,
      sourceText: input.sourceText,
      inputMode: input.inputMode,
      hook: "",
      suggestedTitle: "",
      suggestedDescription: "",
      status: "draft",
      settings: input.settings,
      scenes: [],
      createdAt: now,
      updatedAt: now,
    };
    write([project, ...read()]);
    return project;
  },
  async updateProject(project: Project): Promise<Project> {
    const updated = { ...project, updatedAt: new Date().toISOString() };
    write(read().map((item) => (item.id === project.id ? updated : item)));
    return updated;
  },
  async deleteProject(id: string): Promise<void> {
    write(read().filter((item) => item.id !== id));
  },
  async duplicateProject(id: string): Promise<Project> {
    const original = await this.getProject(id);
    const copy = {
      ...original,
      id: crypto.randomUUID(),
      title: `${original.title} — bản sao`,
      status: "draft" as const,
      scenes: original.scenes.map((scene) => ({
        ...scene,
        id: crypto.randomUUID(),
        mediaStatus: "pending" as const,
        imagePath: null,
        videoPath: null,
        audioPath: null,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    write([copy, ...read()]);
    return copy;
  },
  async getJobs(_projectId: string): Promise<Job[]> {
    return [];
  },
};
