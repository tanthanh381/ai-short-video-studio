import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type FormEvent, type ReactNode } from "react";
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
  isVoicePreset,
  voiceHint,
  DEFAULT_VOICE_PRESET,
  VOICE_PRESETS,
  type Job,
  type LocalModelCatalog,
  type LocalModels,
  type Project,
  type ProjectSettings,
  type Scene,
  type RegenerationComponent,
} from "@studio/shared";
import { useAuth } from "./state/AuthContext";
import { api, type VideoResult } from "./lib/api";
import { appConfig } from "./lib/config";
import { projectIsProcessing } from "./lib/video-submission";
import { restoredPreviewTime, signedPreviewIsFresh, startSignedPreviewRefresh } from "./lib/preview-session";

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
    <div
      className={`notice notice-${tone}`}
      role={tone === "warn" ? "alert" : "status"}
      aria-live={tone === "warn" ? "assertive" : "polite"}
    >
      <CircleAlert size={18} /> <span>{children}</span>
    </div>
  );
}

function Button({
  children,
  variant = "primary",
  busy,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      type={type}
      className={`button button-${variant}`}
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <LoaderCircle className="spin" size={17} /> : null}
      {children}
    </button>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { isDemo, signOut, user } = useAuth();
  const [mobileNav, setMobileNav] = useState(false);
  const displayName =
    (typeof user?.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    user?.email?.split("@")[0] ||
    "Bạn";
  const initials = displayName
    .split(/\s+/u)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "SV";
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
            <div className="avatar" aria-hidden="true">{initials}</div>
            <div>
              <strong>{displayName}</strong>
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
            storyboard trên máy này; tạo video cần kết nối máy xử lý thật.
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
  const { signIn, sendMagicLink, sendPasswordReset, user, isDemo } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [useMagicLink, setUseMagicLink] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);
  if (user) return <Navigate to="/" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    if (resetMode) {
      const nextError = await sendPasswordReset(email);
      setError(nextError);
      setSent(!nextError);
      if (!nextError) setCooldown(60);
      setBusy(false);
      return;
    }
    if (useMagicLink) {
      const nextError = await sendMagicLink(email);
      setError(nextError);
      setSent(!nextError);
      if (!nextError) setCooldown(60);
      setBusy(false);
      return;
    }
    const nextError = await signIn(email, password);
    setError(nextError);
    setBusy(false);
    if (!nextError) navigate("/");
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
          <h1>{resetMode ? "Đặt lại mật khẩu" : "Đăng nhập vào studio"}</h1>
          <p>
            {resetMode
              ? "Nhập email được cấp quyền để nhận liên kết đặt mật khẩu."
              : "Không gian riêng để sản xuất video ngắn tiếng Việt."}
          </p>
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
              {!useMagicLink && !resetMode && (
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
              )}
              {error && <Notice tone="warn">{error}</Notice>}
              {sent && (
                <Notice tone="success">
                  {resetMode
                    ? "Đã gửi email đặt lại mật khẩu. Vui lòng mở email và bấm liên kết."
                    : "Đã gửi liên kết đăng nhập. Vui lòng kiểm tra email và bấm liên kết để mở Studio."}
                </Notice>
              )}
              <Button type="submit" busy={busy} disabled={cooldown > 0}>
                {resetMode
                  ? cooldown > 0
                    ? `Gửi lại sau ${cooldown}s`
                    : "Gửi email đặt mật khẩu"
                  : useMagicLink
                    ? cooldown > 0
                      ? `Gửi lại sau ${cooldown}s`
                      : "Gửi liên kết đăng nhập"
                    : "Đăng nhập"}
              </Button>
              {resetMode ? (
                <button
                  className="login-method"
                  type="button"
                  onClick={() => {
                    setResetMode(false);
                    setError(null);
                    setSent(false);
                  }}
                >
                  Quay lại đăng nhập
                </button>
              ) : (
                <>
                  <button
                    className="login-method"
                    type="button"
                    onClick={() => {
                      setUseMagicLink((value) => !value);
                      setError(null);
                      setSent(false);
                    }}
                  >
                    {useMagicLink
                      ? "Đăng nhập bằng mật khẩu"
                      : "Đăng nhập bằng liên kết email"}
                  </button>
                  {!useMagicLink && (
                    <button
                      className="login-method"
                      type="button"
                      onClick={() => {
                        setResetMode(true);
                        setError(null);
                        setSent(false);
                      }}
                    >
                      Quên hoặc chưa có mật khẩu?
                    </button>
                  )}
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function ResetPasswordPage() {
  const { updatePassword, signOut, user, isDemo } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Mật khẩu phải có ít nhất 8 ký tự.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận chưa khớp.");
      return;
    }
    setBusy(true);
    const nextError = await updatePassword(password);
    setBusy(false);
    if (nextError) {
      setError(nextError);
      return;
    }
    setDone(true);
    await signOut();
  }

  if (isDemo || !user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="vertical-frame">
          <div className="frame-sun" />
          <div className="frame-caption">
            Bảo vệ không gian
            <br />
            sản xuất của bạn.
          </div>
          <div className="sound-wave">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <i key={n} />)}
          </div>
        </div>
      </div>
      <div className="login-panel">
        <div className="login-box">
          <div className="brand login-brand">
            <div className="brand-mark"><Clapperboard size={24} /></div>
            <div><strong>Short Video</strong><span>Studio</span></div>
          </div>
          <h1>Đặt mật khẩu mới</h1>
          <p>Mật khẩu mới áp dụng cho tài khoản {user.email}.</p>
          {done ? (
            <>
              <Notice tone="success">Đã cập nhật mật khẩu. Anh có thể đăng nhập lại.</Notice>
              <Button type="button" onClick={() => navigate("/login")}>Về trang đăng nhập</Button>
            </>
          ) : (
            <form onSubmit={submit}>
              <label>
                Mật khẩu mới
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
              </label>
              <label>
                Nhập lại mật khẩu
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
              </label>
              {error && <Notice tone="warn">{error}</Notice>}
              <Button type="submit" busy={busy}>Lưu mật khẩu</Button>
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
  const [error, setError] = useState<string | null>(null);
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const navigate = useNavigate();
  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải danh sách dự án.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadProjects(); }, []);
  const filtered = projects.filter((p) =>
    `${p.title} ${p.hook} ${p.sourceText}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function remove(id: string) {
    if (
      !window.confirm(
        "Xóa dự án này? Media không còn dùng sẽ được dọn theo chính sách lưu trữ.",
      )
    )
      return;
    setBusyProject(id);
    setError(null);
    try {
      await api.deleteProject(id);
      setProjects((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể xóa dự án. Hãy thử lại.");
    } finally {
      setBusyProject(null);
    }
  }
  async function duplicate(id: string) {
    setBusyProject(id);
    setError(null);
    try {
      const project = await api.duplicateProject(id);
      setProjects((p) => [project, ...p]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể nhân bản dự án. Hãy thử lại.");
    } finally {
      setBusyProject(null);
    }
  }
  return (
    <div className="page dashboard">
      <div className="page-heading">
        <div>
          <h1>Hôm nay mình kể câu chuyện gì?</h1>
          <p>
            Dán kịch bản, bấm Tạo video và nhận bản MP4 hoàn chỉnh.
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
            aria-label="Tìm kiếm dự án"
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
      {error && (
        <div className="dashboard-feedback">
          <Notice tone="warn">
            <span>{error}</span>
            <Button variant="ghost" onClick={() => void loadProjects()}>Thử lại</Button>
          </Notice>
        </div>
      )}
      {loading ? (
        <div className="empty">
          <LoaderCircle className="spin" /> Đang mở danh sách…
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <FolderOpen size={42} />
          <h2>{projects.length ? "Không tìm thấy dự án" : "Bắt đầu với video đầu tiên"}</h2>
          <p>{projects.length ? "Thử tên video, chủ đề hoặc từ khóa khác." : "Dán kịch bản của bạn và để Studio tạo storyboard, hình ảnh, giọng đọc và MP4."}</p>
          <Button onClick={() => navigate("/new")}><Plus size={17} /> Tạo video mới</Button>
        </div>
      ) : (
        <div className="project-list">
          {filtered.map((project, index) => (
            <article
              className="project-row"
              key={project.id}
              onClick={() => navigate(`/studio/${project.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(`/studio/${project.id}`);
                }
              }}
              role="link"
              tabIndex={0}
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
                  aria-label={`Nhân bản ${project.title}`}
                  disabled={busyProject === project.id}
                  onClick={() => void duplicate(project.id)}
                >
                  <Copy size={18} />
                </button>
                <button title="Xóa" aria-label={`Xóa ${project.title}`} disabled={busyProject === project.id} onClick={() => void remove(project.id)}>
                  <Trash2 size={18} />
                </button>
                <button
                  title="Mở dự án"
                  aria-label={`Mở ${project.title}`}
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


const previewUrls = new Map<string, string>();

function VoicePreview({ voice, engine, disabled }: { voice: string; engine: string | null; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  useEffect(() => { audio.current?.pause(); setState("idle"); setError(null); }, [voice, engine]);
  async function toggle() {
    if (state === "playing") { audio.current?.pause(); setState("idle"); return; }
    setError(null);
    setState("loading");
    try {
      const key = `${voice}|${engine ?? ""}`;
      let url = previewUrls.get(key);
      if (!url) {
        url = URL.createObjectURL(await api.voicePreview(voice, engine));
        previewUrls.set(key, url);
      }
      audio.current?.pause();
      const player = new Audio(url);
      audio.current = player;
      player.onended = () => setState("idle");
      player.onpause = () => setState("idle");
      player.onerror = () => { setState("idle"); setError("Không phát được bản nghe thử"); };
      setState("playing"); // the button must not stay on "loading" if the browser delays playback
      await player.play();
    } catch (e) {
      setState("idle");
      setError(e instanceof Error ? e.message : "Chưa nghe thử được giọng đọc");
    }
  }
  return (
    <div className="voice-preview">
      <Button type="button" variant="ghost" disabled={disabled || state === "loading"} onClick={() => void toggle()}>
        {state === "playing" ? <><Pause size={16} /> Dừng</> : <><Play size={16} /> {state === "loading" ? "Đang tạo..." : "Nghe thử giọng"}</>}
      </Button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

function useLocalModels(disabled: boolean) {
  const [catalog, setCatalog] = useState<LocalModelCatalog | null>(null);
  useEffect(() => {
    if (disabled) return;
    let active = true;
    api.getLocalModels().then((value) => active && setCatalog(value)).catch(() => undefined);
    return () => { active = false; };
  }, [disabled]);
  return catalog;
}

const LOCAL_MODEL_TASKS: Array<{ key: keyof LocalModels; label: string }> = [
  { key: "storyboard", label: "Chia cảnh & prompt ảnh (Ollama)" },
  { key: "image", label: "Tạo ảnh" },
  { key: "tts", label: "Giọng đọc (engine)" },
  { key: "transcribe", label: "Đồng bộ phụ đề (Whisper)" },
];

function LocalModelPicker({ value, onChange, catalog }: {
  value: LocalModels;
  onChange(next: LocalModels): void;
  catalog: LocalModelCatalog | null;
}) {
  return (
    <>
      {LOCAL_MODEL_TASKS.map(({ key, label }) => {
        const entry = catalog?.[key];
        const models = entry?.models ?? [];
        const current = value[key];
        const defaultLabel = models.find((model) => model.id === entry?.default)?.label;
        return (
          <Field key={key} label={label} {...(catalog && !catalog.available ? { hint: "Chưa đọc được danh sách từ máy tạo video" } : {})}>
            <select
              value={current ?? ""}
              disabled={!catalog?.available}
              onChange={(e) => onChange({ ...value, [key]: e.target.value || null })}
            >
              <option value="">{defaultLabel ? `Mặc định — ${defaultLabel}` : "Mặc định của máy"}</option>
              {current && !models.some((model) => model.id === current) && <option value={current}>{current} (không còn trên máy)</option>}
              {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </Field>
        );
      })}
    </>
  );
}

function NewProjectPage() {
  const navigate = useNavigate();
  const { isDemo } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [settings, setSettings] = useState<ProjectSettings>(
    { ...DEFAULT_PROJECT_SETTINGS, textProvider: "ollama", mediaProvider: "local", voice: DEFAULT_VOICE_PRESET },
  );
  const [advanced, setAdvanced] = useState(false);
  const localModels = useLocalModels(isDemo || !advanced);
  const submitting = useRef(false);
  const wordCount = sourceText.trim() ? sourceText.trim().split(/\s+/u).length : 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createVideo({ sourceText, settings });
      navigate(`/studio/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa thể bắt đầu tạo video. Hãy thử lại.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function saveDraft() {
    if (submitting.current || sourceText.trim().length < 10) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({
        title: sourceText.trim().split(/[\n.!?]/u)[0]?.slice(0, 120) || "Video mới",
        sourceText,
        inputMode: "full-script",
        settings,
      });
      navigate(`/studio/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể lưu bản nháp.");
    } finally {
      submitting.current = false;
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
          <h1>Kịch bản của anh, video hoàn chỉnh.</h1>
          <p>Studio tự chia cảnh, tạo ảnh, đọc tiếng Việt, đồng bộ phụ đề và ghép video.</p>
        </div>
      </div>
      <form className="creation-form" onSubmit={submit}>
        <section>
          <Field
            label="Kịch bản"
            hint="Giữ nguyên câu chữ và dấu tiếng Việt. Thời lượng video theo giọng đọc thực tế."
          >
            <textarea
              aria-label="Nội dung kịch bản"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              required
              minLength={10}
              maxLength={30000}
              rows={10}
              disabled={busy}
              placeholder="Dán toàn bộ lời đọc cho video vào đây…"
            />
            <div className="script-meta" aria-live="polite">
              <span>{sourceText.length.toLocaleString("vi-VN")} / 30.000 ký tự</span>
              <span>{wordCount.toLocaleString("vi-VN")} từ</span>
            </div>
          </Field>
          <div className="creation-defaults">
            <span><Video size={15} /> Video dọc 1080 × 1920</span>
            <span><Mic2 size={15} /> Giọng tiếng Việt</span>
            <span><Subtitles size={15} /> Phụ đề rõ nét</span>
          </div>
          {error && <Notice tone="warn">{error}</Notice>}
          {isDemo && <Notice tone="warn">Chế độ mẫu chỉ lưu và chỉnh kịch bản. Tạo MP4 cần kết nối máy xử lý.</Notice>}
        </section>
        <section>
          <button className="advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            Tùy chọn video {advanced ? <ChevronUp /> : <ChevronDown />}
          </button>
        </section>
        <section hidden={!advanced}>
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
              <span>Cho phép viết lại kịch bản trước khi tạo video</span>
            </label>
        </section>
        <section hidden={!advanced}>
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
            <Field label="Nhịp chia cảnh" hint="Chỉ tham khảo khi chia cảnh. Thời lượng xuất luôn theo audio thực tế.">
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
        <section hidden={!advanced}>
            <div className="form-grid advanced-panel">
              <Field label="Giọng đọc theo nội dung" hint={voiceHint(settings.voice)}>
                <select
                  value={settings.voice}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, voice: e.target.value }))
                  }
                >
                  {VOICE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </select>
              </Field>
              <VoicePreview voice={settings.voice} engine={settings.localModels.tts} disabled={isDemo} />
              <LocalModelPicker
                catalog={localModels}
                value={settings.localModels}
                onChange={(next) => setSettings((s) => ({ ...s, localModels: next }))}
              />
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
        </section>
        <div className="form-actions">
          <Button type="button" variant="ghost" disabled={busy || sourceText.trim().length < 10} onClick={() => void saveDraft()}>
            <Save size={17} /> Lưu bản nháp
          </Button>
          <Button type="submit" busy={busy} disabled={isDemo}>
            <Clapperboard size={18} /> Tạo video
          </Button>
        </div>
        <p className="creation-footnote">Xử lý trên máy đã kết nối, không gọi API trả phí. Máy cần bật trong lúc tạo video.</p>
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
  onRegenerate(component?: RegenerationComponent): void;
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
        <details className="scene-repair" onClick={(e) => e.stopPropagation()}>
          <summary>Sửa riêng thành phần</summary>
          <div className="scene-repair-actions">
            <button type="button" disabled={!scene.audioPath || !scene.actualDurationMs}
              onClick={() => onRegenerate("image")}>Tạo lại ảnh</button>
            <button type="button" disabled={!scene.imagePath}
              onClick={() => onRegenerate("audio")}>Tạo lại giọng và phụ đề</button>
            <button type="button" disabled={!scene.imagePath || !scene.audioPath}
              onClick={() => onRegenerate("subtitles")}>Đồng bộ lại phụ đề</button>
          </div>
        </details>
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
  const localModels = useLocalModels(isDemo);
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState(0);
  const [sourceDraft, setSourceDraft] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [saved, setSaved] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<VideoResult | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [capabilities, setCapabilities] = useState<{
    ai: boolean;
    openai: boolean;
    anthropic: boolean;
    ollama: boolean;
    localMedia: boolean;
    render: boolean;
  } | null>(
    isDemo
      ? { ai: false, openai: false, anthropic: false, ollama: false, localMedia: false, render: false }
      : null,
  );
  const saveTimer = useRef<number | null>(null);
  const pendingEdits = useRef<Project | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const locked = useRef(false);
  const previewRefreshes = useRef(new Set<string>());
  const freshResult = useRef<VideoResult | null>(null);
  const freshResultSignedAt = useRef(0);
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const pendingPlayback = useRef<{ time: number; playing: boolean } | null>(null);
  const previewRecoveryInFlight = useRef(false);
  const processing = projectIsProcessing(jobs);
  locked.current = processing || Boolean(busyAction);
  useEffect(() => {
    void Promise.all([
      api.getProject(id),
      api.getJobs(id),
      isDemo ? Promise.resolve(null) : api.getSettings(),
    ])
      .then(([p, j, account]) => {
        setProject(p);
        setSourceDraft(p.sourceText);
        setJobs(j);
        if (account) setCapabilities(account.capabilities);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Không thể mở dự án"),
      );
  }, [id, isDemo]);
  useEffect(() => {
    if (isDemo || !processing) return;
    let refreshing = false;
    let active = true;
    const timer = window.setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      void Promise.all([api.getJobs(id), api.getProject(id)])
        .then(([nextJobs, nextProject]) => {
          if (!active) return;
          setJobs(nextJobs);
          setProject(nextProject);
          setSourceDraft(nextProject.sourceText);
          setError(null);
        })
        .catch(() => active && setError("Mất kết nối tạm thời. Tác vụ vẫn được lưu; studio sẽ tiếp tục cập nhật khi kết nối trở lại."))
        .finally(() => { refreshing = false; });
    }, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [id, isDemo, processing]);
  useEffect(() => {
    if (isDemo || !project || processing) return;
    let active = true;
    setResultLoading(true);
    void api.getResult(id)
      .then((next) => { if (active) { freshResult.current = next; freshResultSignedAt.current = Date.now(); setResult(next); } })
      .catch(() => { if (active && project.status === "completed") setError("Chưa tải được video hoàn chỉnh. Hãy kiểm tra kết nối rồi mở lại dự án."); })
      .finally(() => { if (active) setResultLoading(false); });
    return () => { active = false; };
  }, [id, isDemo, project?.status, processing, jobs[0]?.updatedAt]);
  useEffect(() => {
    if (isDemo || processing || !result) return;
    return startSignedPreviewRefresh(() => api.getResult(id), (next) => { freshResult.current = next; freshResultSignedAt.current = Date.now(); });
  }, [id, isDemo, processing, result?.id]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
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
    if (locked.current) return;
    setProject(next);
    setSaved(false);
    pendingEdits.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushEdits().catch(() => {}), 700);
  }
  async function flushEdits() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (saving.current) {
      await saving.current;
      if (pendingEdits.current) return flushEdits();
      return;
    }
    const write = async () => {
      while (pendingEdits.current) {
        const next = pendingEdits.current;
        pendingEdits.current = null;
        try {
          const updated = await api.updateProject(next);
          if (!pendingEdits.current) { setProject(updated); setSaved(true); }
        } catch (e) {
          pendingEdits.current ??= next;
          setSaved(false);
          setError(e instanceof Error ? e.message : "Chưa lưu được chỉnh sửa. Hãy thử lại trước khi tạo video.");
          throw e;
        }
      }
    };
    saving.current = write();
    try { await saving.current; } finally { saving.current = null; }
  }
  async function createVideo() {
    if (locked.current) return;
    if (isDemo) { setError("Chế độ mẫu chỉ lưu bản nháp. Tạo MP4 cần kết nối máy xử lý thật."); return; }
    locked.current = true;
    setBusyAction("create_video");
    setError(null);
    try {
      await flushEdits();
      const job = await api.continueVideo(id);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể bắt đầu tạo video.");
    } finally { setBusyAction(null); }
  }
  async function downloadResult() {
    if (!result) return;
    setBusyAction("download");
    try {
      const { url } = await api.exportDownload(result.id);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Chưa tải được file MP4. Hãy thử lại.");
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${project?.title ?? "video"}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải video.");
    } finally { setBusyAction(null); }
  }
  function updateScene(index: number, scene: Scene) {
    if (!project) return;
    const scenes = [...project.scenes];
    const previous = scenes[index];
    const narrationChanged = previous?.narration !== scene.narration;
    const imageChanged = previous?.imagePrompt !== scene.imagePrompt;
    scenes[index] = {
      ...scene,
      ...(narrationChanged ? { audioPath: null, actualDurationMs: null, subtitles: [], mediaStatus: "pending" as const } : {}),
      ...(imageChanged ? { imagePath: null, mediaStatus: "pending" as const } : {}),
    };
    change({ ...project, scenes, status: "draft" });
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
    if (locked.current) return;
    if (isDemo) {
      setError(
        type === "storyboard"
          ? "Chế độ mẫu chưa gọi AI. Anh vẫn có thể thêm, xóa và sửa từng cảnh thủ công."
          : "Tính năng này cần kết nối backend và API key thật; ứng dụng không giả lập kết quả.",
      );
      return;
    }
    if (
      (type === "generate_media" || type === "render_video") &&
      !project?.scenes.length
    ) {
      setError(
        "Dự án chưa có cảnh. Hãy bấm Chia cảnh hoặc Thêm cảnh trước khi tiếp tục.",
      );
      return;
    }
    const storyboardEnabled =
      project?.settings.textProvider === "anthropic"
        ? capabilities?.anthropic
        : project?.settings.textProvider === "ollama"
          ? capabilities?.ollama
          : capabilities?.openai;
    const requestedAiEnabled =
      type === "storyboard"
        ? storyboardEnabled
        : type === "generate_media"
          ? Boolean(capabilities?.openai || capabilities?.localMedia)
          : true;
    if (!requestedAiEnabled) {
      setError(
        type === "storyboard"
          ? `Chưa cấu hình ${project?.settings.textProvider === "anthropic" ? "Claude" : project?.settings.textProvider === "ollama" ? "Ollama" : "OpenAI"} cho phần kịch bản.`
          : "Chưa cấu hình OpenAI hoặc media local để tạo ảnh, giọng đọc và đồng bộ phụ đề. Anh vẫn có thể tải media của mình lên.",
      );
      return;
    }
    if (type === "render_video" && !capabilities?.render) {
      setError("Worker render chưa được cấu hình trên máy chủ.");
      return;
    }
    setBusyAction(type);
    locked.current = true;
    setError(null);
    try {
      await flushEdits();
      if (type === "generate_media") {
        const estimate = await api.estimate(id);
        const accepted = estimate.estimatedUsd === 0 || window.confirm(
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
    if (locked.current) return;
    if (isDemo) {
      setError(
        "Tải media để render cần kết nối kho lưu trữ. Chế độ mẫu không giữ file cá nhân.",
      );
      return;
    }
    setBusyAction(`upload-${index}-${kind}`);
    locked.current = true;
    setError(null);
    try {
      const path = await api.uploadMedia(id, file, kind);
      const scene = project.scenes[index];
      if (!scene) return;
      const updatedScene: Scene = {
        ...scene,
        ...(kind === "image" ? { imagePath: path } : { audioPath: path }),
        ...(kind === "audio" ? { actualDurationMs: null, subtitles: [] } : {}),
        mediaStatus: "pending",
        errorMessage: null,
      };
      const next = { ...project, scenes: project.scenes.map((item, sceneIndex) => sceneIndex === index ? updatedScene : item), status: "draft" as const };
      setProject(next);
      pendingEdits.current = next;
      setSaved(false);
      await flushEdits();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải file");
    } finally {
      setBusyAction(null);
    }
  }
  async function regenerate(sceneId: string, component: RegenerationComponent = "all") {
    if (isDemo) {
      setError("Tạo lại cảnh cần kết nối OpenAI và worker thật.");
      return;
    }
    if (locked.current) return;
    if (!(capabilities?.openai || capabilities?.localMedia)) {
      setError("Máy tạo ảnh và giọng đọc chưa được kết nối.");
      return;
    }
    setBusyAction(`regenerate-${sceneId}`);
    locked.current = true;
    try {
      await flushEdits();
      const estimate = await api.estimate(id);
      if (estimate.estimatedUsd > 0 &&
        !window.confirm(
          `Tạo lại riêng cảnh này có thể phát sinh khoảng ${(estimate.estimatedUsd / Math.max(1, estimate.imageCount)).toFixed(2)} USD. Tiếp tục?`,
        )
      )
        return;
      const job = await api.regenerateScene(id, sceneId, component);
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
    if (locked.current) return;
    if (isDemo) {
      setError("Tải nhạc cần kết nối kho lưu trữ.");
      return;
    }
    setBusyAction("music");
    locked.current = true;
    try {
      const path = await api.uploadMedia(id, file, "music");
      const next = {
        ...project,
        settings: { ...project.settings, backgroundMusicPath: path },
      };
      setProject(next);
      pendingEdits.current = next;
      setSaved(false);
      await flushEdits();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải nhạc");
    } finally {
      setBusyAction(null);
    }
  }
  async function retry(jobId: string) {
    if (locked.current) return;
    locked.current = true;
    setBusyAction(`retry-${jobId}`);
    setError(null);
    try {
      await flushEdits();
      const failed = jobs.find((item) => item.id === jobId);
      const job = failed?.type === "create_video"
        ? await api.continueVideo(id)
        : await api.retryJob(jobId);
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
      : project.settings.textProvider === "ollama"
        ? capabilities?.ollama
        : capabilities?.openai;
  const zeroCostMode = Boolean(
    capabilities && !capabilities.ai && !capabilities.localMedia && capabilities.render,
  );
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
            aria-label="Tên video"
            disabled={processing || Boolean(busyAction)}
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
          <Button onClick={() => void createVideo()} busy={busyAction === "create_video"} disabled={processing || Boolean(busyAction) || sourceDraft.trim().length < 10}>
            <Video size={17} /> {failedJob ? "Tiếp tục tạo video" : "Tạo video"}
          </Button>
          <Button variant="secondary" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}>
            <Settings size={17} /> Tùy chọn
          </Button>
          <details className="manual-actions">
            <summary>Chỉnh từng bước <ChevronDown size={15} /></summary>
            <div>
          <Button
            variant="secondary"
            onClick={() => void runAction("storyboard")}
            busy={busyAction === "storyboard"}
            disabled={processing || Boolean(busyAction) || (!isDemo && !storyboardEnabled)}
            title={
              storyboardEnabled
                ? "Dùng nhà cung cấp AI đã cấu hình để chia cảnh"
                : "Chế độ 0 đồng API: tự thêm và sửa cảnh thủ công"
            }
          >
            <WandSparkles size={17} />
            Chia cảnh
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runAction("generate_media")}
            busy={busyAction === "generate_media"}
            disabled={
              processing || Boolean(busyAction) || (!isDemo &&
              (!project.scenes.length ||
                !(capabilities?.openai || capabilities?.localMedia)))
            }
            title={
              !project.scenes.length
                ? "Hãy bấm Chia cảnh hoặc Thêm cảnh trước"
                : capabilities?.openai
                ? "Tạo ảnh, giọng đọc và phụ đề bằng OpenAI"
                : capabilities?.localMedia
                  ? "Tạo ảnh, giọng đọc và phụ đề local"
                : "Chế độ 0 đồng API: tải ảnh và audio của anh lên"
            }
          >
            <Sparkles size={17} />
            Tạo media
          </Button>
          <Button
            onClick={() => void runAction("render_video")}
            busy={busyAction === "render_video"}
            disabled={processing || Boolean(busyAction) || (!isDemo && (!project.scenes.length || !capabilities?.render))}
            title={!project.scenes.length ? "Hãy tạo ít nhất một cảnh trước" : undefined}
          >
            <Video size={17} /> Xuất video
          </Button>
            </div>
          </details>
        </div>
      </div>
      {error && (
        <div className="studio-notice">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}
      {!isDemo && capabilities && zeroCostMode && (
        <div className="studio-notice">
          <Notice tone="info">
            Đang chạy chế độ 0 đồng API: anh có thể tự viết storyboard, tải ảnh
            và audio lên từng cảnh, sau đó xuất MP4 bằng worker FFmpeg local.
            Không có cuộc gọi OpenAI hoặc Claude nào được tạo.
          </Notice>
        </div>
      )}
      {!isDemo &&
        capabilities &&
        !zeroCostMode &&
        (!storyboardEnabled ||
          !(capabilities.openai || capabilities.localMedia) ||
          !capabilities.render) && (
          <div className="studio-notice">
            <Notice tone="warn">
              {!storyboardEnabled
                ? "Máy chia cảnh chưa được kết nối. "
                : ""}
              {!capabilities.openai && !capabilities.localMedia
                ? "Máy tạo ảnh và giọng đọc chưa được kết nối. "
                : ""}
              {!capabilities.render
                ? "Máy ghép video chưa được kết nối."
                : ""}
            </Notice>
          </div>
        )}
      {activeJob && (
        <div className="job-progress" role="status" aria-live="polite">
          <div>
            <strong>{activeJob.stage}</strong>
            <span>{activeJob.progress}%</span>
          </div>
          <div className="progress-track">
            <i style={{ width: `${activeJob.progress}%` }} />
          </div>
          <p className="processing-hint">Có thể đóng hoặc tải lại trang. Studio sẽ tiếp tục theo dõi tác vụ đã lưu.</p>
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
            <RefreshCw size={16} /> Tiếp tục từ bước lỗi
          </Button>
        </div>
      )}
      <div className={`studio-grid ${optionsOpen ? "" : "studio-basic"}`}>
        <section className="scene-panel">
          <div className="panel-heading">
            <div>
              <h2>Kịch bản & cảnh</h2>
              <span>
                {project.scenes.length} cảnh · {formatDuration(totalMs)}
              </span>
            </div>
            <button onClick={addScene} disabled={processing || Boolean(busyAction)}>
              <Plus size={17} /> Thêm cảnh
            </button>
          </div>
          <fieldset className="scene-editor" disabled={processing || Boolean(busyAction)}>
            <details className="source-editor">
              <summary>Kịch bản đầy đủ <ChevronDown size={16} /></summary>
              <label className="field">
                <span>Lời đọc gốc</span>
                <textarea value={sourceDraft} rows={7} maxLength={30000} onChange={(e) => setSourceDraft(e.target.value)} onBlur={() => {
                  if (sourceDraft === project.sourceText) return;
                  if (sourceDraft.trim().length < 10) { setError("Kịch bản cần ít nhất 10 ký tự. Nội dung cũ vẫn được giữ."); return; }
                  setSelected(0);
                  setResult(null);
                  change({ ...project, sourceText: sourceDraft, inputMode: "full-script", scenes: [], status: "draft" });
                }} />
                <small>Sửa kịch bản sẽ chia lại cảnh khi bấm Tạo video. Mặc định giữ nguyên lời.</small>
              </label>
            </details>
          {project.scenes.length === 0 ? (
            <div className="empty-scenes">
              <BookOpenText />
              <h3>Chưa có cảnh</h3>
              <p>
                {processing ? "Studio đang chia kịch bản thành các cảnh. Cảnh thật sẽ xuất hiện khi bước này hoàn tất." : "Bấm Tạo video để studio tự thực hiện, hoặc thêm cảnh để soạn thủ công."}
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
                  onRegenerate={(component) => void regenerate(scene.id, component)}
                />
              ))}
            </div>
          )}
          </fieldset>
        </section>
        <section className="preview-panel">
          <div className="preview-stage">
            <div
              className={`video-preview ratio-${project.settings.aspectRatio.replace(":", "-")}`}
            >
              {result ? (
                <video
                  ref={videoElement}
                  key={result.id}
                  className="result-video"
                  controls
                  playsInline
                  preload="metadata"
                  poster={result.thumbnailUrl}
                  src={result.url}
                  aria-label="Video MP4 đã hoàn tất"
                  onLoadedMetadata={(e) => {
                    if (!pendingPlayback.current) return;
                    e.currentTarget.currentTime = restoredPreviewTime(pendingPlayback.current.time, e.currentTarget.duration);
                  }}
                  onCanPlay={(e) => {
                    const previous = pendingPlayback.current;
                    pendingPlayback.current = null;
                    if (previous?.playing) void e.currentTarget.play().catch(() => {});
                  }}
                  onError={() => {
                    if (previewRecoveryInFlight.current) return;
                    if (previewRefreshes.current.has(result.url)) {
                      setError("Chưa mở được video. Hãy kiểm tra kết nối hoặc tải MP4 để xem.");
                      return;
                    }
                    previewRefreshes.current.add(result.url);
                    previewRecoveryInFlight.current = true;
                    const previous = pendingPlayback.current ?? { time: videoElement.current?.currentTime ?? 0, playing: videoElement.current ? !videoElement.current.paused : false };
                    const cached = freshResult.current;
                    const refreshed = cached?.id === result.id && cached.url !== result.url && signedPreviewIsFresh(freshResultSignedAt.current) ? Promise.resolve(cached) : api.getResult(id);
                    void refreshed.then((next) => {
                      if (!next || next.url === result.url) throw new Error("Video chưa thể phát.");
                      pendingPlayback.current = next.id === result.id ? previous : null;
                      freshResult.current = next;
                      freshResultSignedAt.current = Date.now();
                      setResult(next);
                    }).catch(() => setError("Chưa mở được video. Hãy kiểm tra kết nối hoặc tải MP4 để xem."))
                      .finally(() => { previewRecoveryInFlight.current = false; });
                  }}
                />
              ) : <>{previewUrl ? (
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
              {activeScene?.audioPath && <button className="preview-play" aria-label="Nghe lời đọc cảnh đang chọn" onClick={() => void playNarration()}>
                <Play fill="currentColor" />
              </button>}
              </>}
            </div>
          </div>
          <div className="transport">
            <div>
              <strong>{result ? project.status === "completed" && !processing && saved ? "MP4 hoàn chỉnh" : "Bản MP4 đã xuất trước đó" : resultLoading ? "Đang mở kết quả…" : "Ảnh minh họa cảnh"}</strong>
              <span>{result ? `${formatDuration(result.durationMs)} · ${result.width} × ${result.height}` : activeScene ? `Cảnh ${selected + 1}/${project.scenes.length} · ${formatDuration(totalMs)}` : "Video sẽ xuất hiện sau khi ghép xong."}</span>
            </div>
            {result && <Button onClick={() => void downloadResult()} busy={busyAction === "download"}><Download size={17} /> {project.status === "completed" && !processing && saved ? "Tải MP4" : "Tải bản trước"}</Button>}
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
        <aside className="settings-panel" hidden={!optionsOpen}>
          <div className="panel-heading">
            <h2>Thiết lập</h2>
          </div>
          <fieldset className="settings-scroll" disabled={processing || Boolean(busyAction)}>
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
                  <option value="ollama">Ollama (cục bộ)</option>
                </select>
              </Field>
              <p className="microcopy">
                Chọn máy xử lý kịch bản. Tạo video tự động mặc định dùng máy đã kết nối.
              </p>
            </div>
            <div className="setting-group">
              <h3><Image /> Hình ảnh và giọng đọc</h3>
              <Field label="Cách tạo media">
                <select value={project.settings.mediaProvider} onChange={(e) => change({ ...project, settings: { ...project.settings, mediaProvider: e.target.value as ProjectSettings["mediaProvider"] } })}>
                  <option value="local">Máy đã kết nối — không tốn phí API</option>
                  <option value="openai">OpenAI — có phí API</option>
                </select>
              </Field>
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
                  {project.settings.mediaProvider === "local" ? <>
                    {!isVoicePreset(project.settings.voice) && <option value={project.settings.voice}>Giọng tiếng Việt trên máy</option>}
                    {VOICE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </> : <>
                    <option value="alloy">Ấm, trung tính</option>
                    <option value="nova">Sáng, tự nhiên</option>
                    <option value="onyx">Trầm, điềm tĩnh</option>
                  </>}
                </select>
              </Field>
              {project.settings.mediaProvider === "local" && (
                <>
                  <VoicePreview voice={project.settings.voice} engine={project.settings.localModels.tts} disabled={isDemo} />
                  <LocalModelPicker
                    catalog={localModels}
                    value={project.settings.localModels}
                    onChange={(next) => change({ ...project, settings: { ...project.settings, localModels: next } })}
                  />
                </>
              )}
              <Button
                variant="ghost"
                disabled={isDemo || !activeScene?.audioPath}
                onClick={() => void playNarration()}
              >
                <Play size={16} /> Nghe cảnh đang chọn
              </Button>
              <p className="microcopy">
                {project.settings.mediaProvider === "local" && voiceHint(project.settings.voice)
                  ? `${voiceHint(project.settings.voice)}. Cảnh đã có giọng đọc giữ nguyên; giọng mới áp dụng cho cảnh tạo mới.`
                  : "Giọng đọc tổng hợp từ kịch bản của anh."}
              </p>
            </div>
            <div className="setting-group">
              <h3>
                <Subtitles /> Phụ đề
              </h3>
              <p className="microcopy">Lấy đúng chữ từ kịch bản và thời điểm từ giọng đọc thực tế.</p>
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
          </fieldset>
        </aside>
      </div>
    </div>
  );
}

function MediaPage() {
  const { isDemo } = useAuth();
  const [kind, setKind] = useState<"all" | "image" | "audio">("all");
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<
    Array<{
      id: string;
      kind: "image" | "audio";
      projectTitle: string;
      url: string;
    }>
  >([]);
  async function loadMedia() {
    if (isDemo) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await api.listMedia());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải thư viện media.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadMedia(); }, [isDemo]);
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
      {error && <div className="dashboard-feedback"><Notice tone="warn"><span>{error}</span><Button variant="ghost" onClick={() => void loadMedia()}>Thử lại</Button></Notice></div>}
      {loading ? (
        <div className="empty"><LoaderCircle className="spin" /><h2>Đang tải thư viện</h2><p>Đang lấy các ảnh và audio đã lưu của bạn.</p></div>
      ) : shown.length ? (
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
  const [error, setError] = useState<string | null>(null);
  const [busyExport, setBusyExport] = useState<string | null>(null);
  async function loadExports() {
    if (isDemo) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await api.listExports());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải lịch sử xuất video.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadExports(); }, [isDemo]);
  async function downloadExport(exportId: string) {
    setBusyExport(exportId);
    setError(null);
    try {
      const { url } = await api.exportDownload(exportId);
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải MP4. Hãy thử lại.");
    } finally {
      setBusyExport(null);
    }
  }
  return (
    <SimplePage
      title="Lịch sử xuất video"
      subtitle="Theo dõi các bản MP4 đã render và tải lại khi cần."
    >
      {error && <div className="dashboard-feedback"><Notice tone="warn"><span>{error}</span><Button variant="ghost" onClick={() => void loadExports()}>Thử lại</Button></Notice></div>}
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
                <Button busy={busyExport === item.id} onClick={() => void downloadExport(item.id)}>
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
      ollama: false,
      localMedia: false,
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
  const ollamaState = connection(settings.capabilities.ollama);
  const localMediaState = connection(settings.capabilities.localMedia);
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
              <strong>Ollama</strong>
              <span>Chia cảnh cục bộ, không gửi nội dung ra ngoài</span>
            </div>
            <b className={ollamaState.className}>{ollamaState.label}</b>
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
              <strong>Media local</strong>
              <span>SDXL-Turbo MLX, VieNeu/Piper/Linh và Whisper trên máy này</span>
            </div>
            <b className={localMediaState.className}>{localMediaState.label}</b>
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

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("studio_render_error", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="center-page error-recovery" role="alert">
        <CircleAlert size={42} />
        <h1>Studio cần được tải lại</h1>
        <p>Đã xảy ra lỗi hiển thị tạm thời. Dữ liệu đã lưu vẫn được giữ nguyên.</p>
        <Button onClick={() => window.location.reload()}>Tải lại trang</Button>
      </div>
    );
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
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
    </AppErrorBoundary>
  );
}
