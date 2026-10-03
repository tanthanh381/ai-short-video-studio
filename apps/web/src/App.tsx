import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  Film,
  FolderOpen,
  Gauge,
  Image,
  Library,
  LoaderCircle,
  LogOut,
  Menu,
  Mic2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  DEFAULT_PROJECT_SETTINGS,
  formatDuration,
  humanStatus,
  type Job,
  type Project,
  type ProjectSettings,
  type Scene,
} from "@studio/shared";
import { useAuth } from "./state/AuthContext";
import { api } from "./lib/api";
import { appConfig } from "./lib/config";

const navItems = [
  { to: "/", label: "Tổng quan", icon: Gauge },
  { to: "/media", label: "Thư viện media", icon: Library },
  { to: "/exports", label: "Lịch sử xuất", icon: Film },
  { to: "/settings", label: "Cài đặt", icon: Settings },
];

function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warn" | "success";
}) {
  return (
    <div className={`notice notice-${tone}`}>
      <CircleAlert size={18} /> <span>{children}</span>
    </div>
  );
}

function Button({
  children,
  variant = "primary",
  busy,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      className={`button button-${variant}`}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? <LoaderCircle className="spin" size={17} /> : null}
      {children}
    </button>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { isDemo, signOut, user } = useAuth();
  const [mobileNav, setMobileNav] = useState(false);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Clapperboard size={24} />
          </div>
          <div>
            <strong>Short Video</strong>
            <span>Studio</span>
          </div>
        </div>
        <button
          className="mobile-close"
          aria-label="Đóng menu"
          onClick={() => setMobileNav(false)}
        >
          <X />
        </button>
        <nav>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setMobileNav(false)}
            >
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {isDemo && <div className="demo-chip">Chế độ mẫu</div>}
          <div className="user-row">
            <div className="avatar">NT</div>
            <div>
              <strong>Nguyễn Tấn Thành</strong>
              <span>{user?.email}</span>
            </div>
          </div>
          <button className="logout" onClick={() => void signOut()}>
            <LogOut size={17} /> Đăng xuất
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="scrim"
          aria-label="Đóng menu"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main className="main">
        <header className="mobile-header">
          <button onClick={() => setMobileNav(true)} aria-label="Mở menu">
            <Menu />
          </button>
          <span>Short Video Studio</span>
        </header>
        {isDemo && (
          <div className="demo-bar">
            <strong>Đang xem chế độ mẫu.</strong> Anh có thể tạo và sửa
            storyboard trên máy này; tạo AI và xuất MP4 cần kết nối Supabase,
            máy render và API key.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  if (loading)
    return (
      <div className="center-page">
        <LoaderCircle className="spin" />
        <span>Đang kiểm tra đăng nhập…</span>
      </div>
    );
  return user ? (
    <AppShell>{children}</AppShell>
  ) : (
    <Navigate to="/login" replace />
  );
}

function LoginPage() {
  const { signIn, user, isDemo } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(await signIn(email, password));
    setBusy(false);
    if (!error) navigate("/");
  }
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="vertical-frame">
          <div className="frame-sun" />
          <div className="frame-caption">
            Biến một ý tưởng
            <br />
            thành video kể chuyện.
          </div>
          <div className="sound-wave">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <i key={n} />
            ))}
          </div>
        </div>
      </div>
      <div className="login-panel">
        <div className="login-box">
          <div className="brand login-brand">
            <div className="brand-mark">
              <Clapperboard size={24} />
            </div>
            <div>
              <strong>Short Video</strong>
              <span>Studio</span>
            </div>
          </div>
          <h1>Đăng nhập vào studio</h1>
          <p>Không gian riêng để sản xuất video ngắn tiếng Việt.</p>
          {isDemo ? (
            <Notice tone="warn">
              Chưa có cấu hình Supabase. Ứng dụng đang ở chế độ mẫu và không gọi
              dịch vụ AI.
            </Notice>
          ) : (
            <form onSubmit={submit}>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              <label>
                Mật khẩu
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </label>
              {error && <Notice tone="warn">{error}</Notice>}
              <Button type="submit" busy={busy}>
                Đăng nhập
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  useEffect(() => {
    void api
      .listProjects()
      .then(setProjects)
      .finally(() => setLoading(false));
  }, []);
  const filtered = projects.filter((p) =>
    p.title.toLowerCase().includes(query.toLowerCase()),
  );
  async function remove(id: string) {
    if (
      !window.confirm(
        "Xóa dự án này? Media không còn dùng sẽ được dọn theo chính sách lưu trữ.",
      )
    )
      return;
    await api.deleteProject(id);
    setProjects((p) => p.filter((x) => x.id !== id));
  }
  async function duplicate(id: string) {
    const project = await api.duplicateProject(id);
    setProjects((p) => [project, ...p]);
  }
  return (
    <div className="page dashboard">
      <div className="page-heading">
        <div>
          <h1>Hôm nay mình kể câu chuyện gì?</h1>
          <p>
            Bắt đầu từ ý tưởng, hoàn thiện từng cảnh và xuất video khi đã sẵn
            sàng.
          </p>
        </div>
        <Button onClick={() => navigate("/new")}>
          <Plus size={18} /> Tạo video mới
        </Button>
      </div>
      <div className="dashboard-tools">
        <div className="search">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên video…"
          />
        </div>
        <div className="status-legend">
          <span>
            <i className="dot draft" /> Bản nháp
          </span>
          <span>
            <i className="dot working" /> Đang xử lý
          </span>
          <span>
            <i className="dot done" /> Hoàn thành
          </span>
        </div>
      </div>
      {loading ? (
        <div className="empty">
          <LoaderCircle className="spin" /> Đang mở danh sách…
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <FolderOpen size={42} />
          <h2>Chưa có dự án phù hợp</h2>
          <p>Tạo video mới hoặc thử từ khóa khác.</p>
        </div>
      ) : (
        <div className="project-list">
          {filtered.map((project, index) => (
            <article
              className="project-row"
              key={project.id}
              onClick={() => navigate(`/studio/${project.id}`)}
            >
              <div className={`project-thumb thumb-${index % 3}`}>
                <span>{project.settings.aspectRatio}</span>
                <Play size={23} />
                {project.title.includes("mẫu") && <b>Mẫu</b>}
              </div>
              <div className="project-info">
                <div className="project-title-line">
                  <h2>{project.title}</h2>
                  <span className={`status status-${project.status}`}>
                    {humanStatus(project.status)}
                  </span>
                </div>
                <p>{project.hook || project.sourceText}</p>
                <div className="project-meta">
                  <span>
                    <Clock3 size={15} />
                    {project.settings.targetDurationSec} giây
                  </span>
                  <span>
                    <BookOpenText size={15} />
                    {project.scenes.length} cảnh
                  </span>
                  <span>
                    Cập nhật{" "}
                    {new Date(project.updatedAt).toLocaleDateString("vi-VN")}
                  </span>
                </div>
              </div>
              <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  title="Nhân bản"
                  onClick={() => void duplicate(project.id)}
                >
                  <Copy size={18} />
                </button>
                <button title="Xóa" onClick={() => void remove(project.id)}>
                  <Trash2 size={18} />
                </button>
                <button
                  title="Mở dự án"
                  onClick={() => navigate(`/studio/${project.id}`)}
                >
                  <MoreHorizontal size={19} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function NewProjectPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [inputMode, setInputMode] = useState<"idea" | "full-script">("idea");
  const [title, setTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [settings, setSettings] = useState<ProjectSettings>(
    DEFAULT_PROJECT_SETTINGS,
  );
  const [advanced, setAdvanced] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const project = await api.createProject({
        title,
        sourceText,
        inputMode,
        settings: {
          ...settings,
          rewriteFullScript:
            inputMode === "full-script" ? settings.rewriteFullScript : false,
        },
      });
      navigate(`/studio/${project.id}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page narrow">
      <button className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={17} /> Quay lại
      </button>
      <div className="page-heading">
        <div>
          <h1>Tạo dự án mới</h1>
          <p>
            Thông tin này giúp studio chia cảnh đúng nhịp và đúng người xem.
          </p>
        </div>
      </div>
      <form className="creation-form" onSubmit={submit}>
        <section>
          <h2>Nội dung</h2>
          <Field label="Tên video">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ví dụ: Ba điều nên buông bỏ"
              required
              maxLength={160}
            />
          </Field>
          <div className="segmented">
            <button
              type="button"
              className={inputMode === "idea" ? "active" : ""}
              onClick={() => setInputMode("idea")}
            >
              Tôi có ý tưởng
            </button>
            <button
              type="button"
              className={inputMode === "full-script" ? "active" : ""}
              onClick={() => setInputMode("full-script")}
            >
              Tôi có kịch bản hoàn chỉnh
            </button>
          </div>
          <Field
            label={inputMode === "idea" ? "Ý tưởng" : "Kịch bản hoàn chỉnh"}
            hint={
              inputMode === "full-script"
                ? "Mặc định studio giữ nguyên lời và chỉ chia cảnh."
                : "Nêu thông điệp chính, tình huống hoặc điều muốn người xem ghi nhớ."
            }
          >
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              required
              minLength={10}
              rows={7}
              placeholder="Nhập nội dung bằng tiếng Việt…"
            />
          </Field>
          {inputMode === "full-script" && (
            <label className="check">
              <input
                type="checkbox"
                checked={settings.rewriteFullScript}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    rewriteFullScript: e.target.checked,
                  }))
                }
              />
              <span>Cho phép AI viết lại câu chữ</span>
            </label>
          )}
        </section>
        <section>
          <h2>Định dạng video</h2>
          <div className="form-grid">
            <Field label="Đối tượng người xem">
              <input
                value={settings.targetAudience}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, targetAudience: e.target.value }))
                }
              />
            </Field>
            <Field label="Phong cách">
              <select
                value={settings.style}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    style: e.target.value as ProjectSettings["style"],
                  }))
                }
              >
                <option value="ke-chuyen">Kể chuyện</option>
                <option value="kien-thuc">Kiến thức</option>
                <option value="truyen-cam-hung">Truyền cảm hứng</option>
                <option value="meo-cuoc-song">Mẹo cuộc sống</option>
              </select>
            </Field>
            <Field label="Thời lượng mục tiêu">
              <select
                value={settings.targetDurationSec}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    targetDurationSec: Number(e.target.value) as 30 | 60 | 90,
                  }))
                }
              >
                <option value={30}>30 giây</option>
                <option value={60}>60 giây</option>
                <option value={90}>90 giây</option>
              </select>
            </Field>
            <Field label="Tỷ lệ">
              <select
                value={settings.aspectRatio}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    aspectRatio: e.target
                      .value as ProjectSettings["aspectRatio"],
                  }))
                }
              >
                <option>9:16</option>
                <option>1:1</option>
                <option>16:9</option>
              </select>
            </Field>
          </div>
        </section>
        <section>
          <button
            className="advanced-toggle"
            type="button"
            onClick={() => setAdvanced(!advanced)}
          >
            Tùy chọn nâng cao {advanced ? <ChevronUp /> : <ChevronDown />}
          </button>
          {advanced && (
            <div className="form-grid advanced-panel">
              <Field label="AI chia cảnh và viết kịch bản">
                <select
                  value={settings.textProvider}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      textProvider: e.target
                        .value as ProjectSettings["textProvider"],
                    }))
                  }
                >
                  <option value="anthropic">Claude</option>
                  <option value="openai">ChatGPT / OpenAI</option>
                </select>
              </Field>
              <Field label="Giọng đọc">
                <select
                  value={settings.voice}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, voice: e.target.value }))
                  }
                >
                  <option value="alloy">Ấm, trung tính</option>
                  <option value="nova">Sáng, tự nhiên</option>
                  <option value="onyx">Trầm, điềm tĩnh</option>
                </select>
              </Field>
              <Field label="Phong cách hình ảnh">
                <input
                  value={settings.visualStyle}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, visualStyle: e.target.value }))
                  }
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.allowUploads}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      allowUploads: e.target.checked,
                    }))
                  }
                />
                <span>Cho phép dùng ảnh tự tải lên</span>
              </label>
            </div>
          )}
        </section>
        <div className="form-actions">
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Hủy
          </Button>
          <Button type="submit" busy={busy}>
            <Clapperboard size={18} /> Tạo dự án
          </Button>
        </div>
      </form>
    </div>
  );
}

function SceneCard({
  scene,
  selected,
  onSelect,
  onChange,
  onDelete,
  onMove,
  onUpload,
  onRegenerate,
}: {
  scene: Scene;
  selected: boolean;
  onSelect(): void;
  onChange(next: Scene): void;
  onDelete(): void;
  onMove(direction: -1 | 1): void;
  onUpload(file: File, kind: "image" | "audio"): void;
  onRegenerate(): void;
}) {
  return (
    <article
      className={`scene-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="scene-number">{scene.order + 1}</div>
      <div className="scene-content">
        <textarea
          aria-label={`Lời đọc cảnh ${scene.order + 1}`}
          value={scene.narration}
          onChange={(e) => onChange({ ...scene, narration: e.target.value })}
        />
        <input
          aria-label={`Prompt ảnh cảnh ${scene.order + 1}`}
          value={scene.imagePrompt}
          onChange={(e) => onChange({ ...scene, imagePrompt: e.target.value })}
        />
        <div className="scene-foot">
          <span>
            {formatDuration(
              scene.actualDurationMs ?? scene.estimatedDurationMs,
            )}
          </span>
          <span className={`media-state ${scene.mediaStatus}`}>
            {scene.mediaStatus === "ready"
              ? "Đã có media"
              : scene.mediaStatus === "failed"
                ? "Tạo lỗi"
                : "Chưa tạo media"}
          </span>
          <div>
            <label className="icon-upload" title="Tải ảnh thay thế">
              <Image />
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file, "image");
                  e.target.value = "";
                }}
              />
            </label>
            <label className="icon-upload" title="Tải audio lời đọc">
              <Mic2 />
              <input
                type="file"
                accept="audio/mpeg,audio/wav,audio/mp4,audio/aac"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file, "audio");
                  e.target.value = "";
                }}
              />
            </label>
            <button
              title="Tạo lại riêng cảnh này"
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate();
              }}
            >
              <RefreshCw />
            </button>
            <button
              title="Đưa lên"
              onClick={(e) => {
                e.stopPropagation();
                onMove(-1);
              }}
            >
              <ChevronUp />
            </button>
            <button
              title="Đưa xuống"
              onClick={(e) => {
                e.stopPropagation();
                onMove(1);
              }}
            >
              <ChevronDown />
            </button>
            <button
              title="Xóa cảnh"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function StudioPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { isDemo } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [saved, setSaved] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<{
    ai: boolean;
    openai: boolean;
    anthropic: boolean;
    render: boolean;
  } | null>(
    isDemo
      ? { ai: false, openai: false, anthropic: false, render: false }
      : null,
  );
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    void Promise.all([
      api.getProject(id),
      api.getJobs(id),
      isDemo ? Promise.resolve(null) : api.getSettings(),
    ])
      .then(([p, j, account]) => {
        setProject(p);
        setJobs(j);
        if (account) setCapabilities(account.capabilities);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Không thể mở dự án"),
      );
  }, [id, isDemo]);
  useEffect(() => {
    if (
      isDemo ||
      !jobs.some((j) => j.status === "queued" || j.status === "running")
    )
      return;
    const timer = window.setInterval(() => {
      void Promise.all([api.getJobs(id), api.getProject(id)]).then(
        ([nextJobs, nextProject]) => {
          setJobs(nextJobs);
          setProject(nextProject);
        },
      );
    }, 2500);
    return () => clearInterval(timer);
  }, [id, isDemo, jobs]);
  useEffect(() => {
    const path = project?.scenes[selected]?.imagePath;
    if (!path || isDemo) {
      setPreviewUrl(null);
      return;
    }
    let active = true;
    void api
      .mediaUrl(id, path)
      .then(({ url }) => active && setPreviewUrl(url))
      .catch(() => active && setPreviewUrl(null));
    return () => {
      active = false;
    };
  }, [id, isDemo, project?.scenes, selected]);
  function change(next: Project) {
    setProject(next);
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () =>
        void api
          .updateProject(next)
          .then(setProject)
          .then(() => setSaved(true)),
      700,
    );
  }
  function updateScene(index: number, scene: Scene) {
    if (!project) return;
    const scenes = [...project.scenes];
    scenes[index] = scene;
    change({ ...project, scenes });
  }
  function moveScene(index: number, direction: -1 | 1) {
    if (!project) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= project.scenes.length) return;
    const scenes = [...project.scenes];
    const a = scenes[index];
    const b = scenes[nextIndex];
    if (!a || !b) return;
    scenes[index] = { ...b, order: index };
    scenes[nextIndex] = { ...a, order: nextIndex };
    setSelected(nextIndex);
    change({ ...project, scenes });
  }
  function addScene() {
    if (!project) return;
    const scene: Scene = {
      id: crypto.randomUUID(),
      order: project.scenes.length,
      narration: "Nhập lời đọc cho cảnh mới",
      imagePrompt: "Mô tả hình ảnh minh họa cho cảnh",
      estimatedDurationMs: 5000,
      actualDurationMs: null,
      imagePath: null,
      audioPath: null,
      thumbnailUrl: null,
      mediaStatus: "pending",
      errorMessage: null,
      subtitles: [],
    };
    change({ ...project, scenes: [...project.scenes, scene] });
    setSelected(project.scenes.length);
  }
  function deleteScene(index: number) {
    if (!project) return;
    const scenes = project.scenes
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, order: i }));
    change({ ...project, scenes });
    setSelected(Math.max(0, index - 1));
  }
  async function runAction(
    type: "storyboard" | "generate_media" | "render_video",
  ) {
    if (isDemo) {
      setError(
        type === "storyboard"
          ? "Chế độ mẫu chưa gọi AI. Anh vẫn có thể thêm, xóa và sửa từng cảnh thủ công."
          : "Tính năng này cần kết nối backend và API key thật; ứng dụng không giả lập kết quả.",
      );
      return;
    }
    const storyboardEnabled =
      project?.settings.textProvider === "anthropic"
        ? capabilities?.anthropic
        : capabilities?.openai;
    const requestedAiEnabled =
      type === "storyboard"
        ? storyboardEnabled
        : type === "generate_media"
          ? capabilities?.openai
          : true;
    if (!requestedAiEnabled) {
      setError(
        type === "storyboard"
          ? `Chưa cấu hình ${project?.settings.textProvider === "anthropic" ? "Claude" : "OpenAI"} cho phần kịch bản.`
          : "Chưa cấu hình OpenAI để tạo ảnh, giọng đọc và đồng bộ phụ đề. Anh vẫn có thể tải media của mình lên.",
      );
      return;
    }
    if (type === "render_video" && !capabilities?.render) {
      setError("Worker render chưa được cấu hình trên máy chủ.");
      return;
    }
    setBusyAction(type);
    setError(null);
    try {
      if (type === "generate_media") {
        const estimate = await api.estimate(id);
        const accepted = window.confirm(
          `Ước tính chi phí tạo media: ${estimate.estimatedUsd.toFixed(2)} USD cho ${estimate.imageCount} ảnh. Đây là ước tính, chi phí thực tế do nhà cung cấp tính. Tiếp tục?`,
        );
        if (!accepted) return;
      }
      const job = await api.queue(id, type);
      setJobs((j) => [job, ...j]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tạo tác vụ");
    } finally {
      setBusyAction(null);
    }
  }
  async function uploadScene(
    index: number,
    file: File,
    kind: "image" | "audio",
  ) {
    if (!project) return;
    if (isDemo) {
      setError(
        "Tải media để render cần kết nối kho lưu trữ. Chế độ mẫu không giữ file cá nhân.",
      );
      return;
    }
    setBusyAction(`upload-${index}-${kind}`);
    setError(null);
    try {
      const path = await api.uploadMedia(id, file, kind);
      const scene = project.scenes[index];
      if (!scene) return;
      updateScene(index, {
        ...scene,
        ...(kind === "image" ? { imagePath: path } : { audioPath: path }),
        mediaStatus: "pending",
        errorMessage: null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải file");
    } finally {
      setBusyAction(null);
    }
  }
  async function regenerate(sceneId: string) {
    if (isDemo) {
      setError("Tạo lại cảnh cần kết nối OpenAI và worker thật.");
      return;
    }
    if (!capabilities?.openai) {
      setError("Tạo lại cảnh cần cấu hình OpenAI trên worker.");
      return;
    }
    setBusyAction(`regenerate-${sceneId}`);
    try {
      const estimate = await api.estimate(id);
      if (
        !window.confirm(
          `Tạo lại riêng cảnh này có thể phát sinh khoảng ${(estimate.estimatedUsd / Math.max(1, estimate.imageCount)).toFixed(2)} USD. Tiếp tục?`,
        )
      )
        return;
      const job = await api.regenerateScene(id, sceneId);
      setJobs((current) => [job, ...current]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tạo lại cảnh");
    } finally {
      setBusyAction(null);
    }
  }
  async function playNarration() {
    if (!activeScene?.audioPath) {
      setError("Cảnh đang chọn chưa có audio để nghe thử.");
      return;
    }
    try {
      const { url } = await api.mediaUrl(id, activeScene.audioPath);
      await new Audio(url).play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể phát audio");
    }
  }
  async function uploadMusic(file: File) {
    if (!project) return;
    if (isDemo) {
      setError("Tải nhạc cần kết nối kho lưu trữ.");
      return;
    }
    setBusyAction("music");
    try {
      const path = await api.uploadMedia(id, file, "music");
      change({
        ...project,
        settings: { ...project.settings, backgroundMusicPath: path },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải nhạc");
    } finally {
      setBusyAction(null);
    }
  }
  async function retry(jobId: string) {
    setBusyAction(`retry-${jobId}`);
    setError(null);
    try {
      const job = await api.retryJob(jobId);
      setJobs((current) => [
        job,
        ...current.filter((item) => item.id !== job.id),
      ]);
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : "Không thể thử lại tác vụ",
      );
    } finally {
      setBusyAction(null);
    }
  }
  if (error && !project)
    return (
      <div className="page">
        <Notice tone="warn">{error}</Notice>
      </div>
    );
  if (!project)
    return (
      <div className="center-page">
        <LoaderCircle className="spin" /> Đang mở studio…
      </div>
    );
  const activeScene = project.scenes[selected];
  const activeJob = jobs.find(
    (j) => j.status === "queued" || j.status === "running",
  );
  const failedJob = jobs[0]?.status === "failed" ? jobs[0] : null;
  const totalMs = project.scenes.reduce(
    (sum, s) => sum + (s.actualDurationMs ?? s.estimatedDurationMs),
    0,
  );
  const storyboardEnabled =
    project.settings.textProvider === "anthropic"
      ? capabilities?.anthropic
      : capabilities?.openai;
  return (
    <div className="studio">
      <div className="studio-top">
        <div>
          <button className="back-link" onClick={() => navigate("/")}>
            <ArrowLeft size={16} /> Dự án
          </button>
          <input
            className="studio-title"
            value={project.title}
            onChange={(e) => change({ ...project, title: e.target.value })}
          />
          <span className="save-state">
            {saved ? (
              <>
                <Check size={14} /> Đã lưu
              </>
            ) : (
              <>
                <LoaderCircle className="spin" size={14} /> Đang lưu
              </>
            )}
          </span>
        </div>
        <div className="studio-actions">
          <Button
            variant="secondary"
            onClick={() => void runAction("storyboard")}
            busy={busyAction === "storyboard"}
            disabled={!isDemo && !storyboardEnabled}
          >
            <WandSparkles size={17} /> Chia cảnh
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runAction("generate_media")}
            busy={busyAction === "generate_media"}
            disabled={!isDemo && !capabilities?.openai}
          >
            <Sparkles size={17} /> Tạo media
          </Button>
          <Button
            onClick={() => void runAction("render_video")}
            busy={busyAction === "render_video"}
            disabled={!isDemo && !capabilities?.render}
          >
            <Video size={17} /> Xuất video
          </Button>
        </div>
      </div>
      {error && (
        <div className="studio-notice">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}
      {!isDemo &&
        capabilities &&
        (!storyboardEnabled ||
          !capabilities.openai ||
          !capabilities.render) && (
          <div className="studio-notice">
            <Notice tone="warn">
              {!storyboardEnabled
                ? `Chưa cấu hình ${project.settings.textProvider === "anthropic" ? "Claude" : "OpenAI"}: Chia cảnh đang tắt. `
                : ""}
              {!capabilities.openai
                ? "Chưa cấu hình OpenAI: Tạo ảnh, giọng đọc và phụ đề đang tắt. "
                : ""}
              {!capabilities.render
                ? "Chưa cấu hình worker: Xuất MP4 đang tắt."
                : ""}
            </Notice>
          </div>
        )}
      {activeJob && (
        <div className="job-progress">
          <div>
            <strong>{activeJob.stage}</strong>
            <span>{activeJob.progress}%</span>
          </div>
          <div className="progress-track">
            <i style={{ width: `${activeJob.progress}%` }} />
          </div>
        </div>
      )}
      {failedJob && !activeJob && (
        <div className="job-error">
          <div>
            <strong>{failedJob.stage}</strong>
            <span>
              {failedJob.errorMessage ??
                "Tác vụ chưa hoàn tất. Dữ liệu các cảnh thành công vẫn được giữ."}
            </span>
          </div>
          <Button
            variant="secondary"
            busy={busyAction === `retry-${failedJob.id}`}
            onClick={() => void retry(failedJob.id)}
          >
            <RefreshCw size={16} /> Thử lại
          </Button>
        </div>
      )}
      <div className="studio-grid">
        <section className="scene-panel">
          <div className="panel-heading">
            <div>
              <h2>Kịch bản & cảnh</h2>
              <span>
                {project.scenes.length} cảnh · {formatDuration(totalMs)}
              </span>
            </div>
            <button onClick={addScene}>
              <Plus size={17} /> Thêm cảnh
            </button>
          </div>
          {project.scenes.length === 0 ? (
            <div className="empty-scenes">
              <BookOpenText />
              <h3>Chưa có cảnh</h3>
              <p>
                Chọn “Chia cảnh” khi đã kết nối AI, hoặc thêm cảnh để soạn thủ
                công.
              </p>
              <Button variant="secondary" onClick={addScene}>
                <Plus size={17} /> Thêm cảnh đầu tiên
              </Button>
            </div>
          ) : (
            <div className="scene-list">
              {project.scenes.map((scene, index) => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  selected={index === selected}
                  onSelect={() => setSelected(index)}
                  onChange={(next) => updateScene(index, next)}
                  onDelete={() => deleteScene(index)}
                  onMove={(dir) => moveScene(index, dir)}
                  onUpload={(file, kind) => void uploadScene(index, file, kind)}
                  onRegenerate={() => void regenerate(scene.id)}
                />
              ))}
            </div>
          )}
        </section>
        <section className="preview-panel">
          <div className="preview-stage">
            <div
              className={`video-preview ratio-${project.settings.aspectRatio.replace(":", "-")}`}
            >
              {previewUrl ? (
                <img
                  className="preview-image"
                  src={previewUrl}
                  alt="Ảnh cảnh đang chọn"
                />
              ) : (
                <div className="preview-art">
                  <div className="preview-orb" />
                  <div className="preview-ridge" />
                  <span>
                    {activeScene
                      ? `Cảnh ${activeScene.order + 1}`
                      : "Xem trước"}
                  </span>
                </div>
              )}
              {project.settings.subtitle.enabled && activeScene && (
                <div
                  className={`subtitle-preview subtitle-${project.settings.subtitle.position}`}
                >
                  {activeScene.narration.slice(0, 70)}
                </div>
              )}
              <button className="preview-play" aria-label="Phát xem trước">
                <Play fill="currentColor" />
              </button>
            </div>
          </div>
          <div className="transport">
            <button>
              <Play size={18} />
            </button>
            <span>00:00</span>
            <div className="scrubber">
              <i />
            </div>
            <span>{formatDuration(totalMs)}</span>
          </div>
          <div className="timeline">
            <div className="timeline-label">
              <span>Timeline</span>
              <small>
                Thời lượng cập nhật theo audio thật sau khi tạo giọng đọc
              </small>
            </div>
            <div className="timeline-track">
              {project.scenes.map((s, i) => (
                <button
                  key={s.id}
                  className={i === selected ? "active" : ""}
                  style={{
                    flex: Math.max(
                      1,
                      s.actualDurationMs ?? s.estimatedDurationMs,
                    ),
                  }}
                  onClick={() => setSelected(i)}
                >
                  <span>{i + 1}</span>
                  <i />
                </button>
              ))}
            </div>
          </div>
        </section>
        <aside className="settings-panel">
          <div className="panel-heading">
            <h2>Thiết lập</h2>
          </div>
          <div className="settings-scroll">
            <div className="setting-group">
              <h3>
                <Sparkles /> AI kịch bản
              </h3>
              <Field label="Nhà cung cấp">
                <select
                  value={project.settings.textProvider}
                  onChange={(e) =>
                    change({
                      ...project,
                      settings: {
                        ...project.settings,
                        textProvider: e.target
                          .value as ProjectSettings["textProvider"],
                      },
                    })
                  }
                >
                  <option value="anthropic">Claude</option>
                  <option value="openai">ChatGPT / OpenAI</option>
                </select>
              </Field>
              <p className="microcopy">
                Chỉ áp dụng khi bấm “Chia cảnh”. Ảnh, giọng đọc và phụ đề dùng
                OpenAI.
              </p>
            </div>
            <div className="setting-group">
              <h3>
                <Mic2 /> Giọng đọc
              </h3>
              <Field label="Giọng tiếng Việt">
                <select
                  value={project.settings.voice}
                  onChange={(e) =>
                    change({
                      ...project,
                      settings: { ...project.settings, voice: e.target.value },
                    })
                  }
                >
                  <option value="alloy">Ấm, trung tính</option>
                  <option value="nova">Sáng, tự nhiên</option>
                  <option value="onyx">Trầm, điềm tĩnh</option>
                </select>
              </Field>
              <Button
                variant="ghost"
                disabled={isDemo || !activeScene?.audioPath}
                onClick={() => void playNarration()}
              >
                <Play size={16} /> Nghe thử
              </Button>
              <p className="microcopy">Giọng đọc được tạo bởi AI.</p>
            </div>
            <div className="setting-group">
              <h3>
                <Subtitles /> Phụ đề
              </h3>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={project.settings.subtitle.enabled}
                  onChange={(e) =>
                    change({
                      ...project,
                      settings: {
                        ...project.settings,
                        subtitle: {
                          ...project.settings.subtitle,
                          enabled: e.target.checked,
                        },
                      },
                    })
                  }
                />
                <span /> Bật phụ đề
              </label>
              <Field label="Kiểu chữ">
                <select
                  value={project.settings.subtitle.preset}
                  onChange={(e) =>
                    change({
                      ...project,
                      settings: {
                        ...project.settings,
                        subtitle: {
                          ...project.settings.subtitle,
                          preset: e.target.value as
                            | "classic"
                            | "focus"
                            | "minimal",
                        },
                      },
                    })
                  }
                >
                  <option value="classic">Rõ nét</option>
                  <option value="focus">Nhấn từ khóa</option>
                  <option value="minimal">Tối giản</option>
                </select>
              </Field>
              <Field label="Vị trí">
                <select
                  value={project.settings.subtitle.position}
                  onChange={(e) =>
                    change({
                      ...project,
                      settings: {
                        ...project.settings,
                        subtitle: {
                          ...project.settings.subtitle,
                          position: e.target.value as
                            | "top"
                            | "center"
                            | "bottom",
                        },
                      },
                    })
                  }
                >
                  <option value="top">Phía trên</option>
                  <option value="center">Chính giữa</option>
                  <option value="bottom">Vùng an toàn phía dưới</option>
                </select>
              </Field>
              {activeScene && (
                <div className="cue-editor">
                  <div className="cue-heading">
                    <strong>Timestamp cảnh đang chọn</strong>
                    <button
                      onClick={() =>
                        updateScene(selected, {
                          ...activeScene,
                          subtitles: [
                            ...activeScene.subtitles,
                            {
                              id: crypto.randomUUID(),
                              startMs: 0,
                              endMs: Math.min(
                                2000,
                                activeScene.actualDurationMs ??
                                  activeScene.estimatedDurationMs,
                              ),
                              text: "Phụ đề mới",
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} /> Thêm
                    </button>
                  </div>
                  {activeScene.subtitles.map((cue, cueIndex) => (
                    <div className="cue-row" key={cue.id}>
                      <input
                        aria-label="Bắt đầu phụ đề"
                        type="number"
                        min="0"
                        step="0.1"
                        value={cue.startMs / 1000}
                        onChange={(e) => {
                          const subtitles = [...activeScene.subtitles];
                          subtitles[cueIndex] = {
                            ...cue,
                            startMs: Math.round(Number(e.target.value) * 1000),
                          };
                          updateScene(selected, { ...activeScene, subtitles });
                        }}
                      />
                      <input
                        aria-label="Kết thúc phụ đề"
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={cue.endMs / 1000}
                        onChange={(e) => {
                          const subtitles = [...activeScene.subtitles];
                          subtitles[cueIndex] = {
                            ...cue,
                            endMs: Math.round(Number(e.target.value) * 1000),
                          };
                          updateScene(selected, { ...activeScene, subtitles });
                        }}
                      />
                      <input
                        aria-label="Nội dung phụ đề"
                        value={cue.text}
                        onChange={(e) => {
                          const subtitles = [...activeScene.subtitles];
                          subtitles[cueIndex] = {
                            ...cue,
                            text: e.target.value,
                          };
                          updateScene(selected, { ...activeScene, subtitles });
                        }}
                      />
                    </div>
                  ))}
                  {!activeScene.subtitles.length && (
                    <small>
                      Timestamp sẽ được tạo từ audio thật; anh cũng có thể thêm
                      thủ công.
                    </small>
                  )}
                </div>
              )}
            </div>
            <div className="setting-group">
              <h3>
                <Music2 /> Nhạc nền
              </h3>
              <Field label="Âm lượng">
                <input
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.01"
                  value={project.settings.musicVolume}
                  onChange={(e) =>
                    change({
                      ...project,
                      settings: {
                        ...project.settings,
                        musicVolume: Number(e.target.value),
                      },
                    })
                  }
                />
                <small>
                  {Math.round(project.settings.musicVolume * 100)}% · tự động
                  thấp hơn lời đọc
                </small>
              </Field>
              <label className="button button-ghost file-button">
                <Upload size={16} />
                {project.settings.backgroundMusicPath
                  ? "Thay nhạc nền"
                  : "Tải nhạc có bản quyền"}
                <input
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/mp4,audio/aac"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadMusic(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <details className="setting-group">
              <summary>
                Xuất video <ChevronDown size={17} />
              </summary>
              <Field label="Tỷ lệ">
                <select
                  value={project.settings.aspectRatio}
                  onChange={(e) =>
                    change({
                      ...project,
                      settings: {
                        ...project.settings,
                        aspectRatio: e.target
                          .value as ProjectSettings["aspectRatio"],
                      },
                    })
                  }
                >
                  <option>9:16</option>
                  <option>1:1</option>
                  <option>16:9</option>
                </select>
              </Field>
              <p className="microcopy">
                Preset dọc xuất ở 1080 × 1920, H.264 + AAC.
              </p>
            </details>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MediaPage() {
  const { isDemo } = useAuth();
  const [kind, setKind] = useState<"all" | "image" | "audio">("all");
  const [items, setItems] = useState<
    Array<{
      id: string;
      kind: "image" | "audio";
      projectTitle: string;
      url: string;
    }>
  >([]);
  useEffect(() => {
    if (!isDemo) void api.listMedia().then(setItems);
  }, [isDemo]);
  const shown = items.filter((item) => kind === "all" || item.kind === kind);
  return (
    <SimplePage
      title="Thư viện media"
      subtitle="Ảnh, giọng đọc và nhạc đã dùng trong các dự án."
    >
      <div className="filter-pills">
        <button
          className={kind === "all" ? "active" : ""}
          onClick={() => setKind("all")}
        >
          Tất cả
        </button>
        <button
          className={kind === "image" ? "active" : ""}
          onClick={() => setKind("image")}
        >
          Ảnh
        </button>
        <button
          className={kind === "audio" ? "active" : ""}
          onClick={() => setKind("audio")}
        >
          Giọng đọc
        </button>
      </div>
      {shown.length ? (
        <div className="media-grid">
          {shown.map((item) => (
            <article key={item.id}>
              {item.kind === "image" ? (
                <img src={item.url} alt={item.projectTitle} />
              ) : (
                <div className="audio-tile">
                  <Mic2 />
                  <audio controls src={item.url} />
                </div>
              )}
              <strong>{item.projectTitle}</strong>
              <span>{item.kind === "image" ? "Ảnh cảnh" : "Giọng đọc"}</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Image size={42} />
          <h2>Chưa có media thật</h2>
          <p>
            Media đã tạo hoặc tải lên sẽ xuất hiện ở đây và được bảo vệ bằng
            liên kết có thời hạn.
          </p>
        </div>
      )}
    </SimplePage>
  );
}

function ExportsPage() {
  const { isDemo } = useAuth();
  const [items, setItems] = useState<
    Array<{
      id: string;
      projectTitle: string;
      durationMs: number;
      width: number;
      height: number;
      createdAt: string;
      thumbnailUrl: string;
    }>
  >([]);
  const [loading, setLoading] = useState(!isDemo);
  useEffect(() => {
    if (isDemo) return;
    void api
      .listExports()
      .then(setItems)
      .finally(() => setLoading(false));
  }, [isDemo]);
  async function downloadExport(exportId: string) {
    const { url } = await api.exportDownload(exportId);
    window.location.assign(url);
  }
  return (
    <SimplePage
      title="Lịch sử xuất video"
      subtitle="Theo dõi các bản MP4 đã render và tải lại khi cần."
    >
      {loading ? (
        <div className="empty">
          <LoaderCircle className="spin" /> Đang tải lịch sử…
        </div>
      ) : items.length ? (
        <div className="export-grid">
          {items.map((item) => (
            <article className="export-card" key={item.id}>
              <img
                src={item.thumbnailUrl}
                alt={`Thumbnail ${item.projectTitle}`}
              />
              <div>
                <h2>{item.projectTitle}</h2>
                <p>
                  {formatDuration(item.durationMs)} · {item.width} ×{" "}
                  {item.height} ·{" "}
                  {new Date(item.createdAt).toLocaleDateString("vi-VN")}
                </p>
                <Button onClick={() => void downloadExport(item.id)}>
                  <Download size={17} /> Tải MP4
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Film size={42} />
          <h2>Chưa có bản xuất</h2>
          <p>
            Khi render thành công, thumbnail, thời lượng và nút tải MP4 sẽ xuất
            hiện tại đây.
          </p>
        </div>
      )}
    </SimplePage>
  );
}

function SettingsPage() {
  const { isDemo } = useAuth();
  const [settings, setSettings] = useState({
    dailyBudgetUsd: 3,
    maxConcurrentJobs: 1,
    capabilities: {
      supabase: !isDemo,
      ai: false,
      openai: false,
      anthropic: false,
      render: false,
    },
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isDemo) return;
    void api
      .getSettings()
      .then(setSettings)
      .catch((error: Error) => setMessage(error.message));
  }, [isDemo]);

  async function saveSettings() {
    if (isDemo) {
      setMessage("Chế độ mẫu không thay đổi hạn mức trên máy chủ.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      setSettings(
        await api.updateSettings({
          dailyBudgetUsd: settings.dailyBudgetUsd,
          maxConcurrentJobs: settings.maxConcurrentJobs,
        }),
      );
      setMessage("Đã lưu hạn mức. Backend sẽ áp dụng cho các tác vụ mới.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Không thể lưu cài đặt",
      );
    } finally {
      setBusy(false);
    }
  }

  const connection = (enabled: boolean) => ({
    className: enabled ? "on" : "off",
    label: enabled ? "Đã kết nối" : "Chưa cấu hình",
  });
  const supabaseState = connection(settings.capabilities.supabase);
  const openaiState = connection(settings.capabilities.openai);
  const anthropicState = connection(settings.capabilities.anthropic);
  const renderState = connection(settings.capabilities.render);
  return (
    <SimplePage
      title="Cài đặt"
      subtitle="Quản lý hạn mức, dịch vụ AI và chính sách lưu trữ."
    >
      <div className="settings-page-grid">
        <section>
          <h2>Kết nối dịch vụ</h2>
          <div className="connection-row">
            <div>
              <strong>Supabase</strong>
              <span>Đăng nhập, dữ liệu và media</span>
            </div>
            <b className={supabaseState.className}>{supabaseState.label}</b>
          </div>
          <div className="connection-row">
            <div>
              <strong>Claude</strong>
              <span>Chia cảnh và biên tập kịch bản</span>
            </div>
            <b className={anthropicState.className}>{anthropicState.label}</b>
          </div>
          <div className="connection-row">
            <div>
              <strong>ChatGPT / OpenAI</strong>
              <span>Kịch bản, hình ảnh, giọng đọc và đồng bộ phụ đề</span>
            </div>
            <b className={openaiState.className}>{openaiState.label}</b>
          </div>
          <div className="connection-row">
            <div>
              <strong>Worker render</strong>
              <span>FFmpeg trên máy tự host</span>
            </div>
            <b className={renderState.className}>{renderState.label}</b>
          </div>
        </section>
        <section>
          <h2>Kiểm soát chi phí</h2>
          <Field label="Ngân sách AI mỗi ngày (USD)">
            <input
              type="number"
              min="0"
              max="1000"
              step="0.5"
              value={settings.dailyBudgetUsd}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  dailyBudgetUsd: Number(event.target.value),
                })
              }
            />
          </Field>
          <Field label="Số tác vụ đồng thời">
            <input
              type="number"
              min="1"
              max="5"
              value={settings.maxConcurrentJobs}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  maxConcurrentJobs: Number(event.target.value),
                })
              }
            />
          </Field>
          <p className="microcopy">
            Ước tính được hiển thị trước khi tạo media. Máy chủ chặn tác vụ vượt
            hạn mức và khóa lần bấm trùng.
          </p>
          {message && (
            <Notice tone={message.startsWith("Đã lưu") ? "success" : "warn"}>
              {message}
            </Notice>
          )}
          <Button
            variant="secondary"
            busy={busy}
            onClick={() => void saveSettings()}
          >
            <Save size={17} /> Lưu cài đặt
          </Button>
        </section>
      </div>
    </SimplePage>
  );
}

function SimplePage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function NotFound() {
  return (
    <div className="center-page">
      <h1>Không tìm thấy trang</h1>
      <NavLink to="/">Về tổng quan</NavLink>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <Protected>
            <Routes>
              <Route index element={<DashboardPage />} />
              <Route path="new" element={<NewProjectPage />} />
              <Route path="studio/:id" element={<StudioPage />} />
              <Route path="media" element={<MediaPage />} />
              <Route path="exports" element={<ExportsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Protected>
        }
      />
    </Routes>
  );
}
