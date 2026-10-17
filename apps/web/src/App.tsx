import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ErrorInfo, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Clapperboard,
  Clock3,
  Copy,
  Download,
  FileText,
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
  Move,
  Music2,
  Pause,
  PenLine,
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
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  cleanScriptForNarration,
  DEFAULT_PROJECT_SETTINGS,
  DURATION_OPTIONS,
  KEY_PROVIDER_INFO,
  keyFormatError,
  lastFour,
  type ApiKeySummary,
  type KeyProvider,
  contentPlan,
  durationLabel,
  formatDuration,
  looksLikeSubtitles,
  looksLikeFinishedScript,
  splitScript,
  humanStatus,
  isVoicePreset,
  voiceHint,
  DEFAULT_VOICE_PRESET,
  VOICE_PRESETS,
  type AirSetupSummary,
  type BalancerSummary,
  type Job,
  type LocalModelCatalog,
  type LocalModels,
  type NodeResourceSummary,
  type NodeSummary,
  type Project,
  type ProjectSettings,
  type Scene,
  type RegenerationComponent,
  VISUAL_PRESET_OPTIONS,
  drawsByHand,
  visualPresetPrompt,
} from "@studio/shared";
import { useAuth } from "./state/AuthContext";
const AirSetupPanel = lazy(() => import("./AirSetupPanel").then((module) => ({ default: module.AirSetupPanel })));
const MachinesPanel = lazy(() => import("./MachinesPanel").then((module) => ({ default: module.MachinesPanel })));
const SystemPage = lazy(() => import("./SystemPage").then((module) => ({ default: module.SystemPage })));
import { demoBalancerAfter, demoSystem } from "./lib/demo-system";
import { api, type ServiceId, type ServiceStatus, type UsageStats, type VideoResult } from "./lib/api";
import { appConfig } from "./lib/config";
import { resetPasswordView } from "./lib/auth";
import { withLayoutTemplate, withVisualPreset } from "./lib/visual-preset";
import { ProjectSaver, type SaveState } from "./lib/project-saver";
import { Button, Field, Notice } from "./components/ui";
import { askConfirm, ConfirmHost } from "./components/ConfirmDialog";
import { DEMO_ONLY, DEMO_VOICE } from "./lib/copy";
import { LOGO_MAX_BYTES, checkLogoFile } from "./lib/logo";
import { StageGuides, StageLogo } from "./components/StageLogo";
import { withScriptFromScenes } from "./lib/script-sync";
import { OPENAI_VOICES, hookTitleAllowed, withMediaProvider } from "./lib/options";
import { CHANNEL_PRESETS, estimatedNarrationSeconds } from "./lib/channel-presets";
import { projectIsProcessing } from "./lib/video-submission";
import { restoredPreviewTime, signedPreviewIsFresh, startSignedPreviewRefresh } from "./lib/preview-session";
import { InfoPopover } from "./components/Disclosure";
import { useSaveShortcut } from "./hooks/use-save-shortcut";

const navItems = [
  { to: "/", label: "Tổng quan", icon: Gauge },
  { to: "/new", label: "Tạo video mới", icon: Plus },
  { to: "/dub-subtitle", label: "Lồng tiếng & phụ đề", icon: Subtitles },
  { to: "/tts", label: "Đọc văn bản (TTS)", icon: Mic2 },
  { to: "/media", label: "Thư viện media", icon: Library },
  { to: "/exports", label: "Lịch sử xuất", icon: Film },
  { to: "/system", label: "Hệ thống", icon: Activity },
  { to: "/settings", label: "Cài đặt", icon: Settings },
];

/**
 * Title, caption and hashtags written for the finished video, ready to paste into TikTok, Reels or Shorts.
 * Folded by default so it never takes room from the video preview; copying works without opening it.
 */
function PostCaptionCard({ project }: { project: Project }) {
  const [copied, setCopied] = useState(false);
  const description = project.suggestedDescription.trim();
  // Older projects stored a copy of the script here; that is not a caption worth offering.
  if (!description || project.sourceText.trim().startsWith(description.slice(0, 120))) return null;
  const text = `${project.suggestedTitle.trim()}\n\n${description}`.trim();
  return (
    // The copy button sits next to the summary, not inside it: a button inside a <summary> is a control nested in a
    // control, which screen readers announce badly (WCAG 4.1.2).
    <div className="post-caption-wrap">
      <details className="post-caption">
        <summary>
          <span>Nội dung đăng bài</span>
        </summary>
        {project.suggestedTitle.trim() && <p className="post-caption-title">{project.suggestedTitle}</p>}
        <p className="post-caption-body">{description}</p>
      </details>
      <button
        type="button"
        className="post-caption-copy"
        aria-label={copied ? "Đã sao chép nội dung đăng bài" : "Sao chép nội dung đăng bài"}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          });
        }}
      >
        <Copy size={14} /> {copied ? "Đã sao chép" : "Sao chép"}
      </button>
    </div>
  );
}

const APP_NAME = "AI Short Video Studio";

/** The browser tab says which page this is (WCAG 2.4.2): the menu name, else the page's own heading. */
function pageTitle(pathname: string, heading: string | null): string {
  const item = navItems.find((nav) => (nav.to === "/" ? pathname === "/" : pathname.startsWith(nav.to)));
  const name = item?.label ?? heading?.trim();
  return name ? `${name} · ${APP_NAME}` : APP_NAME;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { isDemo, signOut, user } = useAuth();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
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
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setIsMobileLayout(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (isMobileLayout && !mobileNav) sidebar.setAttribute("inert", "");
    else sidebar.removeAttribute("inert");
    if (isMobileLayout && mobileNav) mobileCloseRef.current?.focus();
  }, [isMobileLayout, mobileNav]);
  // While the phone menu is open, the page behind it is out of reach (focus stays in the menu).
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (isMobileLayout && mobileNav) main.setAttribute("inert", "");
    else main.removeAttribute("inert");
  }, [isMobileLayout, mobileNav]);
  // A new page: name the tab after it and, after a link was followed, move focus to its heading so a screen reader
  // says where the person is (pages load lazily, so the heading is waited for a few frames).
  useEffect(() => {
    // only when the path really changed: not on the first load, and not when React runs the effect twice in dev
    const announce = lastPath.current !== null && lastPath.current !== location.pathname;
    lastPath.current = location.pathname;
    let frames = 0;
    let handle = 0;
    const settle = () => {
      const heading = mainRef.current?.querySelector<HTMLElement>("h1") ?? null;
      if (!heading && frames++ < 30) { handle = requestAnimationFrame(settle); return; }
      document.title = pageTitle(location.pathname, heading?.textContent ?? null);
      if (announce && heading) {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    };
    settle();
    return () => cancelAnimationFrame(handle);
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileNav) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileNav();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNav]);
  function closeMobileNav() {
    setMobileNav(false);
    if (isMobileLayout) window.setTimeout(() => mobileMenuRef.current?.focus(), 0);
  }
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => { event.preventDefault(); mainRef.current?.focus(); }}
      >
        Bỏ qua tới nội dung
      </a>
      <aside
        ref={sidebarRef}
        id="app-navigation"
        aria-label="Điều hướng chính"
        className={`sidebar ${mobileNav ? "is-open" : ""}`}
        aria-hidden={isMobileLayout && !mobileNav ? true : undefined}
      >
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
          ref={mobileCloseRef}
          type="button"
          className="mobile-close"
          aria-label="Đóng menu"
          onClick={closeMobileNav}
        >
          <X />
        </button>
        <nav aria-label="Các trang">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={closeMobileNav}
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
          <button type="button" className="logout" onClick={() => void signOut()}>
            <LogOut size={17} /> Đăng xuất
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          type="button"
          className="scrim"
          aria-label="Đóng menu"
          onClick={closeMobileNav}
        />
      )}
      <main className="main" id="main-content" ref={mainRef} tabIndex={-1}>
        <header className="mobile-header">
          <button
            ref={mobileMenuRef}
            type="button"
            aria-expanded={mobileNav}
            aria-controls="app-navigation"
            onClick={() => setMobileNav(true)}
            aria-label="Mở menu"
          >
            <Menu />
          </button>
          <span>Short Video Studio</span>
        </header>
        {isDemo && (
          <div className="demo-bar">
            <strong>Đang xem chế độ mẫu.</strong> Bạn có thể tạo và sửa kịch bản;
            tạo video cần máy chính đang bật.
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
  const { signIn, signInWithGoogle, sendMagicLink, sendPasswordReset, user, authError, isDemo } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { document.title = `Đăng nhập · ${APP_NAME}`; }, []);
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
  useEffect(() => {
    if (authError) setError(authError);
  }, [authError]);
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
  async function signInWithGoogleAccount() {
    setBusy(true);
    setError(null);
    const nextError = await signInWithGoogle();
    if (nextError) {
      setError(nextError);
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
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
              {!resetMode && (
                <>
                  <button className="google-button" type="button" onClick={() => void signInWithGoogleAccount()} disabled={busy}>
                    <span className="google-mark" aria-hidden="true">G</span>
                    <span>Tiếp tục với Google</span>
                  </button>
                  <div className="login-divider"><span>hoặc dùng email</span></div>
                </>
              )}
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
              {error && <Notice tone="bad">{error}</Notice>}
              {sent && (
                <Notice tone="success">
                  {resetMode
                    ? "Đã gửi email đặt lại mật khẩu. Hãy mở email và bấm vào liên kết."
                    : "Đã gửi liên kết đăng nhập. Hãy mở email và bấm vào liên kết để vào Studio."}
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
    </main>
  );
}

function ResetPasswordPage() {
  useEffect(() => { document.title = `Đặt mật khẩu mới · ${APP_NAME}`; }, []);
  const { updatePassword, signOut, user, isDemo, loading } = useAuth();
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

  const view = resetPasswordView({ loading, user, isDemo });
  if (view === "wait")
    return (
      <div className="center-page">
        <LoaderCircle className="spin" />
        <span>Đang xác nhận liên kết đặt lại mật khẩu…</span>
      </div>
    );
  if (view === "login" || !user) {
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
              <Notice tone="success">Đã cập nhật mật khẩu. Bạn có thể đăng nhập lại.</Notice>
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
              {error && <Notice tone="bad">{error}</Notice>}
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
      setError(e instanceof Error ? e.message : "Chưa tải được danh sách dự án. Kiểm tra kết nối mạng rồi tải lại trang.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadProjects(); }, []);
  const filtered = projects.filter((p) =>
    `${p.title} ${p.hook} ${p.sourceText}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function remove(id: string) {
    const title = projects.find((item) => item.id === id)?.title;
    if (!(await askConfirm({
      title: title ? `Xóa dự án “${title}”?` : "Xóa dự án này?",
      detail: "Kịch bản, cảnh, ảnh và giọng của dự án sẽ mất. Không hoàn tác được.",
      confirmLabel: "Xóa dự án",
      tone: "danger",
    }))) return;
    setBusyProject(id);
    setError(null);
    try {
      await api.deleteProject(id);
      setProjects((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa xóa được dự án. Hãy thử lại sau ít phút.");
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
      setError(e instanceof Error ? e.message : "Chưa nhân bản được dự án. Hãy thử lại.");
    } finally {
      setBusyProject(null);
    }
  }
  return (
    <div className="page dashboard">
      <div className="page-heading">
        <div>
          <h1>Hôm nay mình kể câu chuyện gì?</h1>
          <p>Dán kịch bản, bấm Tạo video và nhận bản MP4 hoàn chỉnh.</p>
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
          <p>{projects.length ? "Thử tên video, chủ đề hoặc từ khóa khác." : "Bắt đầu từ một ý tưởng hoặc kịch bản có sẵn — Studio lo phần chia cảnh, vẽ ảnh, đọc giọng và ghép video."}</p>
          <Button onClick={() => navigate("/new")}><Plus size={17} /> Tạo video mới</Button>
        </div>
      ) : (
        <div className="project-list">
          {filtered.map((project, index) => (
            <article
              className="project-row"
              key={project.id}
              // The whole row opens the project for a mouse; the keyboard and screen readers use the title link, so
              // the row is not a button that holds other buttons (WCAG 4.1.2).
              onClick={() => navigate(`/studio/${project.id}`)}
            >
              <div className={`project-thumb thumb-${index % 3}`}>
                <span>{project.settings.aspectRatio}</span>
                <Play size={23} />
                {project.title.includes("mẫu") && <b>Mẫu</b>}
              </div>
              <div className="project-info">
                <div className="project-title-line">
                  <h2>
                    <Link className="project-link" to={`/studio/${project.id}`} onClick={(event) => event.stopPropagation()}>
                      {project.title}
                    </Link>
                  </h2>
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
                  type="button"
                  title="Nhân bản"
                  aria-label={`Nhân bản ${project.title}`}
                  disabled={busyProject === project.id}
                  onClick={() => void duplicate(project.id)}
                >
                  <Copy size={18} />
                </button>
                <button type="button" title="Xóa" aria-label={`Xóa ${project.title}`} disabled={busyProject === project.id} onClick={() => void remove(project.id)}>
                  <Trash2 size={18} />
                </button>
                <span className="row-open" aria-hidden="true">
                  <ChevronRight size={19} />
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/** Money as Vietnamese readers write it: 0,48 USD. */
function formatUsd(value: number) {
  return `${value.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

function formatSpeed(value: number) {
  return `${value.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

/** Every main button stays clickable and says what is missing, instead of being greyed out without a reason. */
const SOURCE_TOO_SHORT = "Hãy nhập ý tưởng hoặc kịch bản, ít nhất 10 ký tự.";

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

/** The voice engine picker of the TTS and dubbing pages. With no engine to offer it says why and where to fix it. */
function EngineSelect({ catalog, engine, onChange, isDemo }: { catalog: LocalModelCatalog | null; engine: string | null; onChange(next: string | null): void; isDemo: boolean }) {
  const models = catalog?.tts.models ?? [];
  return (
    <div className="engine-select">
      <select aria-label="Bộ tạo giọng" value={engine ?? ""} onChange={(event) => onChange(event.target.value || null)} disabled={!models.length}>
        {!models.length && <option value="">Chưa kết nối</option>}
        {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
      {!models.length && (
        <small className="field-hint">
          {isDemo ? "Chế độ mẫu không tạo giọng đọc." : "Bộ tạo giọng chưa sẵn sàng."} <Link to="/system">Xem trang Hệ thống</Link>
        </small>
      )}
    </div>
  );
}

function TextToSpeechPage() {
  const { isDemo } = useAuth();
  const catalog = useLocalModels(isDemo);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(DEFAULT_VOICE_PRESET);
  const [engine, setEngine] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const defaultEngine = catalog?.tts.default ?? catalog?.tts.models[0]?.id ?? null;
    if (defaultEngine && !engine) setEngine(defaultEngine);
  }, [catalog, engine]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  async function createSpeech() {
    if (isDemo) { setError(DEMO_VOICE); return; }
    if (!text.trim()) { setError("Hãy nhập văn bản cần đọc."); return; }
    setBusy(true); setError(null);
    try {
      const blob = await api.textToSpeech(text, voice, engine, speed);
      setAudioUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa tạo được giọng đọc");
    } finally { setBusy(false); }
  }
  const selectedVoice = VOICE_PRESETS.find((item) => item.id === voice)!;
  return (
    <SimplePage title="Đọc văn bản thành giọng nói" subtitle="Dán văn bản, chọn giọng đọc rồi tải file MP3. Giọng được tạo trên máy của bạn, không tốn phí.">
      <div className="tts-page-grid">
        <section className="tts-editor-card">
          <div className="section-heading-row">
            <h2>Văn bản cần đọc</h2>
            <span className="tts-counter">{text.length.toLocaleString("vi-VN")} / 10.000</span>
          </div>
          <textarea
            className="tts-textarea"
            aria-label="Văn bản cần đọc"
            aria-invalid={error === "Hãy nhập văn bản cần đọc." || undefined}
            aria-describedby={error ? "tts-error" : undefined}
            maxLength={10000}
            value={text}
            onChange={(event) => { setText(event.target.value); setError(null); }}
            placeholder="Nhập hoặc dán văn bản tiếng Việt cần đọc…"
          />
          <div className="tts-editor-footer">
            <span>{selectedVoice.label} · {formatSpeed(speed)}</span>
            <Button busy={busy} onClick={() => void createSpeech()}>
              <Play size={17} /> Chuyển thành giọng nói
            </Button>
          </div>
          {error && <Notice tone="bad" id="tts-error">{error}</Notice>}
          {audioUrl && (
            <div className="tts-result">
              <div><strong>Bản đọc đã sẵn sàng</strong><span>Nghe lại hoặc tải file MP3</span></div>
              <audio controls src={audioUrl} />
              <a className="button button-secondary" href={audioUrl} download="giong-doc-tieng-viet.mp3"><Download size={17} /> Tải MP3</a>
            </div>
          )}
        </section>
        <section className="tts-options-card">
          <h2>Tùy chọn giọng</h2>
          <div className="field"><span className="field-label">Bộ tạo giọng</span>
            <EngineSelect catalog={catalog} engine={engine} onChange={setEngine} isDemo={isDemo} />
          </div>
          <div
            className="tts-voice-grid"
            role="radiogroup"
            aria-label="Chất giọng"
            onKeyDown={(event) => {
              // arrow keys move between the voices, as in any radio group
              const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const at = VOICE_PRESETS.findIndex((item) => item.id === voice);
              const next = VOICE_PRESETS[(at + step + VOICE_PRESETS.length) % VOICE_PRESETS.length]!;
              setVoice(next.id);
              event.currentTarget.querySelector<HTMLButtonElement>(`[data-voice="${next.id}"]`)?.focus();
            }}
          >
            {VOICE_PRESETS.map((preset) => (
              <button key={preset.id} type="button" role="radio" aria-checked={voice === preset.id} data-voice={preset.id} className={`tts-voice-option ${voice === preset.id ? "selected" : ""}`} onClick={() => setVoice(preset.id)}>
                <span><strong>{preset.label}</strong><small>{preset.hint}</small></span>
                <span className="tts-radio" aria-hidden="true">{voice === preset.id ? "✓" : ""}</span>
              </button>
            ))}
          </div>
          <label className="field tts-speed-field"><span>Tốc độ đọc <b>{formatSpeed(speed)}</b></span>
            <input type="range" min="0.75" max="1.25" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
          </label>
          <VoicePreview voice={voice} engine={engine} disabled={isDemo} />
        </section>
      </div>
    </SimplePage>
  );
}

function DubSubtitlePage() {
  const navigate = useNavigate();
  const { isDemo } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState(DEFAULT_VOICE_PRESET);
  const [engine, setEngine] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [subtitlePreset, setSubtitlePreset] = useState<"classic" | "focus" | "minimal">("classic");
  const [subtitlePosition, setSubtitlePosition] = useState<"top" | "center" | "bottom">("bottom");
  const [subtitleFontSize, setSubtitleFontSize] = useState(18);
  const [subtitleColor, setSubtitleColor] = useState("#FFFFFF");
  const [subtitleBackground, setSubtitleBackground] = useState("#000000");
  const [subtitleOpacity, setSubtitleOpacity] = useState(68);
  const [subtitleOutline, setSubtitleOutline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [voicePreviewState, setVoicePreviewState] = useState<"idle" | "loading" | "playing">("idle");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [voicePreviewError, setVoicePreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const catalog = useLocalModels(isDemo);

  useEffect(() => {
    const defaultEngine = catalog?.tts.default ?? catalog?.tts.models[0]?.id ?? null;
    if (defaultEngine && !engine) setEngine(defaultEngine);
  }, [catalog, engine]);
  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
  }, [videoUrl, audioUrl, voicePreviewUrl]);

  function selectVideo(next: File | undefined) {
    if (!next) return;
    if (!next.type.startsWith("video/")) {
      setError("Hãy chọn file video MP4, WebM hoặc MOV.");
      return;
    }
    setError(null);
    setFile(next);
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(next);
    });
  }

  async function createDub() {
    if (!file) { setError("Hãy tải video cần lồng tiếng lên trước."); return; }
    if (!script.trim()) { setError("Hãy nhập lời thoại để tạo giọng đọc và phụ đề."); return; }
    if (isDemo) { setError(DEMO_VOICE); return; }
    setBusy(true); setError(null);
    try {
      const settings = {
        ...DEFAULT_PROJECT_SETTINGS,
        textProvider: "ollama" as const,
        mediaProvider: "local" as const,
        voice,
        localModels: { ...DEFAULT_PROJECT_SETTINGS.localModels, tts: engine },
        subtitle: {
          ...DEFAULT_PROJECT_SETTINGS.subtitle,
          enabled: subtitleEnabled,
          preset: subtitlePreset,
          position: subtitlePosition,
          fontColor: subtitleColor,
          backgroundColor: subtitleBackground,
          backgroundOpacity: subtitleOpacity / 100,
        },
      };
      const project = await api.createProject({
        title: file.name.replace(/\.[^.]+$/u, "") || "Video lồng tiếng",
        sourceText: script,
        inputMode: "full-script",
        settings,
      });
      const sourceVideoPath = await api.uploadMedia(project.id, file, "video");
      await api.queue(project.id, "dub_video", { sourceVideoPath, script, voice, engine, subtitle: settings.subtitle });
      navigate(`/studio/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa bắt đầu lồng tiếng được. Kiểm tra máy chính đang bật rồi bấm lại.");
    } finally { setBusy(false); }
  }

  async function togglePreview() {
    if (!videoRef.current || !audioUrl) return;
    if (playing) {
      videoRef.current.pause();
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    videoRef.current.currentTime = 0;
    if (audioRef.current) { audioRef.current.currentTime = 0; await audioRef.current.play(); }
    await videoRef.current.play();
    setPlaying(true);
  }

  async function toggleVoicePreview() {
    if (voicePreviewState === "playing") {
      voicePreviewAudioRef.current?.pause();
      setVoicePreviewState("idle");
      return;
    }
    if (!script.trim()) {
      setVoicePreviewError("Nhập lời thoại trước khi nghe thử.");
      return;
    }
    if (isDemo) {
      setVoicePreviewError(DEMO_VOICE);
      return;
    }
    setVoicePreviewError(null);
    setVoicePreviewState("loading");
    try {
      const blob = await api.textToSpeech(script, voice, engine, 1);
      const url = URL.createObjectURL(blob);
      setVoicePreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
      const player = voicePreviewAudioRef.current;
      if (!player) throw new Error("Không khởi tạo được trình phát audio");
      player.src = url;
      player.currentTime = 0;
      player.onended = () => setVoicePreviewState("idle");
      player.onpause = () => setVoicePreviewState("idle");
      await player.play();
      setVoicePreviewState("playing");
    } catch (e) {
      setVoicePreviewState("idle");
      setVoicePreviewError(e instanceof Error ? e.message : "Chưa nghe thử được giọng đọc.");
    }
  }

  const subtitleBackgroundColor = `${subtitleBackground}${Math.round(subtitleOpacity * 2.55).toString(16).padStart(2, "0")}`;
  const subtitleShadow = subtitleOutline ? "0 1px 2px #000, 1px 0 0 #000, -1px 0 0 #000" : "none";

  return (
    <SimplePage title="Lồng tiếng & phụ đề" subtitle="Tải video có sẵn, nhập lời thoại và xem ngay bản dựng với giọng đọc tiếng Việt cùng phụ đề.">
      <div className="dub-page-grid">
        <section className="dub-preview-card">
          <div className="section-heading-row">
            <div><h2>Bản xem trước</h2><p>{file ? file.name : "Tải video lên, rồi nhập lời thoại ở cột bên cạnh"}</p></div>
            {audioUrl && <span className="ready-chip"><Check size={14} /> Đã có giọng đọc</span>}
          </div>
          <div className="video-preview-frame">
            {videoUrl ? <>
              <video ref={videoRef} src={videoUrl} onEnded={() => setPlaying(false)} playsInline />
              {subtitleEnabled && script.trim() && <div
                className={`dub-subtitle-overlay dub-subtitle-${subtitlePosition} dub-subtitle-${subtitlePreset}`}
                style={{ color: subtitleColor, backgroundColor: subtitleBackgroundColor, fontSize: `${subtitleFontSize}px`, textShadow: subtitleShadow }}
              >{script.trim()}</div>}
              <audio ref={audioRef} src={audioUrl ?? undefined} onEnded={() => setPlaying(false)} />
            </> : (
              <label className="video-empty video-empty-upload">
                <Upload size={30} />
                <strong>Bước 1 · Tải video lên</strong>
                <span>MP4, WebM hoặc MOV · tối đa 50 MB</span>
                <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => selectVideo(event.target.files?.[0])} />
              </label>
            )}
          </div>
          <div className="dub-preview-actions">
            <Button variant="secondary" disabled={!audioUrl || !videoUrl} onClick={() => void togglePreview()}>
              {playing ? <><Pause size={17} /> Dừng xem thử</> : <><Play size={17} /> Phát video đã lồng tiếng</>}
            </Button>
            <span className="microcopy">Bản xem trước chạy trực tiếp trên trình duyệt.</span>
          </div>
        </section>
        <section className="dub-form-card">
          {file && (
            <label className="upload-dropzone upload-dropzone-compact">
              <Upload size={18} />
              <strong>Đổi video</strong>
              <span>{file.name}</span>
              <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => selectVideo(event.target.files?.[0])} />
            </label>
          )}
          <Field label="Lời thoại lồng tiếng và nội dung phụ đề" hint="Nội dung này sẽ được dùng cho cả giọng đọc và dòng phụ đề xem trước.">
            <textarea value={script} onChange={(event) => setScript(event.target.value)} rows={7} maxLength={10000} placeholder="Nhập lời thoại tiếng Việt…" />
          </Field>
          <div className="dub-form-row">
            <Field label="Giọng đọc">
              <span className="select-with-action">
                <select value={voice} onChange={(event) => setVoice(event.target.value as typeof voice)}>
                  {VOICE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} — {preset.hint}</option>)}
                </select>
                <button
                  type="button"
                  className="icon-action"
                  disabled={voicePreviewState === "loading"}
                  onClick={(event) => { event.preventDefault(); void toggleVoicePreview(); }}
                  aria-label={voicePreviewState === "playing" ? "Dừng nghe thử" : "Nghe thử lời thoại"}
                  title={voicePreviewState === "playing" ? "Dừng nghe thử" : "Nghe thử lời thoại"}
                >
                  {voicePreviewState === "loading" ? <LoaderCircle className="spin" size={16} /> : voicePreviewState === "playing" ? <Pause size={16} /> : <Play size={16} />}
                </button>
              </span>
              {voicePreviewError && <small className="field-error">{voicePreviewError}</small>}
              <audio ref={voicePreviewAudioRef} hidden />
            </Field>
            <div className="field"><span className="field-label">Bộ tạo giọng</span>
              <EngineSelect catalog={catalog} engine={engine} onChange={setEngine} isDemo={isDemo} />
            </div>
          </div>
          <label className="check dub-check">
            <input type="checkbox" checked={subtitleEnabled} onChange={(event) => setSubtitleEnabled(event.target.checked)} />
            <span><strong>Hiển thị phụ đề trên video</strong><small>Kiểm tra vị trí phụ đề ngay trong bản xem trước.</small></span>
          </label>
          <fieldset className="subtitle-format-panel" disabled={!subtitleEnabled}>
            <div className="section-heading-row"><div><h3>Định dạng phụ đề</h3><p>Thay đổi sẽ hiển thị ngay trên khung xem trước.</p></div></div>
            <div className="subtitle-format-grid">
              <Field label="Kiểu hiển thị">
                <select value={subtitlePreset} onChange={(event) => setSubtitlePreset(event.target.value as typeof subtitlePreset)}>
                  <option value="classic">Cổ điển — nền đen</option>
                  <option value="focus">Tập trung — chữ lớn</option>
                  <option value="minimal">Tối giản — nền nhẹ</option>
                </select>
              </Field>
              <Field label="Vị trí">
                <select value={subtitlePosition} onChange={(event) => setSubtitlePosition(event.target.value as typeof subtitlePosition)}>
                  <option value="top">Phía trên</option>
                  <option value="center">Ở giữa</option>
                  <option value="bottom">Phía dưới</option>
                </select>
              </Field>
            </div>
            <div className="subtitle-format-grid">
              <Field label={`Cỡ chữ · ${subtitleFontSize}px`}>
                <input type="range" min="12" max="32" step="1" value={subtitleFontSize} onChange={(event) => setSubtitleFontSize(Number(event.target.value))} />
              </Field>
              <Field label={`Độ đục nền · ${subtitleOpacity}%`}>
                <input type="range" min="0" max="100" step="1" value={subtitleOpacity} onChange={(event) => setSubtitleOpacity(Number(event.target.value))} />
              </Field>
            </div>
            <div className="subtitle-color-row">
              <Field label="Màu chữ"><input type="color" value={subtitleColor} onChange={(event) => setSubtitleColor(event.target.value)} /></Field>
              <Field label="Màu nền"><input type="color" value={subtitleBackground} onChange={(event) => setSubtitleBackground(event.target.value)} /></Field>
              <label className="check"><input type="checkbox" checked={subtitleOutline} onChange={(event) => setSubtitleOutline(event.target.checked)} /><span>Viền chữ</span></label>
            </div>
          </fieldset>
          {error && <Notice tone="bad">{error}</Notice>}
          <Button busy={busy} onClick={() => void createDub()}><WandSparkles size={17} /> Tạo giọng đọc & phụ đề</Button>
        </section>
      </div>
    </SimplePage>
  );
}

const LOCAL_MODEL_TASKS: Array<{ key: keyof LocalModels; label: string }> = [
  { key: "storyboard", label: "Viết kịch bản và mô tả ảnh (Ollama)" },
  { key: "image", label: "Tạo ảnh" },
  { key: "video", label: "Chuyển động video (LTX)" },
  { key: "tts", label: "Giọng đọc" },
  { key: "transcribe", label: "Đồng bộ phụ đề (Whisper)" },
];

/** The video options both the create page and the studio show. One component, so a choice made before the video is made
 * reads, and can be changed, exactly as in the studio afterwards. The studio adds what only a saved project has
 * (logo, music upload, caption style and timing, "listen to this scene") through the `...Extra` slots. */
function VideoOptions({ settings, onChange, scriptMode, isDemo, capabilities, localModels, frameExtra, voiceExtra, musicExtra, subtitleExtra }: {
  settings: ProjectSettings;
  onChange(next: ProjectSettings): void;
  scriptMode: Project["inputMode"];
  isDemo: boolean;
  /** What this account can use right now; null where it is not known yet (the create page). */
  capabilities: { openai: boolean; anthropic: boolean; ollama: boolean; localMedia: boolean } | null;
  localModels: LocalModelCatalog | null;
  frameExtra?: ReactNode;
  voiceExtra?: ReactNode;
  musicExtra?: ReactNode;
  subtitleExtra?: ReactNode;
}) {
  const set = (patch: Partial<ProjectSettings>) => onChange({ ...settings, ...patch });
  const setSubtitle = (patch: Partial<ProjectSettings["subtitle"]>) => onChange({ ...settings, subtitle: { ...settings.subtitle, ...patch } });
  const paidText = settings.textProvider === "anthropic" || settings.textProvider === "openai";
  const paidMedia = settings.mediaProvider === "openai";
  const missingText = paidText && capabilities !== null && !capabilities[settings.textProvider as "anthropic" | "openai"];
  const missingMedia = paidMedia && capabilities !== null && !capabilities.openai;
  const hookAllowed = hookTitleAllowed(settings);
  const local = settings.mediaProvider === "local";
  return (
    <>
      <div className="setting-group">
        <h3><Sparkles /> Máy và dịch vụ tạo video</h3>
        <Field label="AI viết kịch bản">
          <select value={settings.textProvider} onChange={(e) => set({ textProvider: e.target.value as ProjectSettings["textProvider"] })}>
            <option value="ollama">Ollama local — không tốn phí API</option>
            <option value="anthropic">Claude — dùng API trả phí</option>
            <option value="openai">OpenAI — dùng API trả phí</option>
          </select>
        </Field>
        <Field label="Tạo ảnh và giọng đọc">
          <select value={settings.mediaProvider} onChange={(e) => onChange(withMediaProvider(settings, e.target.value as ProjectSettings["mediaProvider"]))}>
            <option value="local">Máy đã kết nối — không tốn phí API</option>
            <option value="openai">OpenAI — dùng API trả phí</option>
          </select>
        </Field>
        {(missingText || missingMedia) && (
          <Notice tone="info">
            Chưa có khóa API {missingText ? KEY_PROVIDER_INFO[settings.textProvider as "anthropic" | "openai"].name : "OpenAI"}. <Link to="/settings">Dán khóa của bạn ở Cài đặt</Link> để dùng, hoặc chọn Ollama và máy đã kết nối.
          </Notice>
        )}
        {capabilities === null && (paidText || paidMedia) && (
          <Notice tone="info">
            Cần lưu khóa API tương ứng tại <Link to="/settings">Cài đặt → Dịch vụ trả phí</Link> trước khi bắt đầu. Chi phí do tài khoản nhà cung cấp của bạn chi trả.
          </Notice>
        )}
      </div>
      <div className="setting-group">
        <h3><BookOpenText /> Nội dung</h3>
        <Field label="Phong cách">
          <select value={settings.style} onChange={(e) => set({ style: e.target.value as ProjectSettings["style"] })}>
            <option value="ke-chuyen">Kể chuyện</option>
            <option value="kien-thuc">Kiến thức</option>
            <option value="truyen-cam-hung">Truyền cảm hứng</option>
            <option value="meo-cuoc-song">Mẹo cuộc sống</option>
          </select>
        </Field>
        <Field label="Đối tượng người xem">
          <input maxLength={500} value={settings.targetAudience} onChange={(e) => set({ targetAudience: e.target.value })} />
        </Field>
        {scriptMode !== "idea" && (
          <label className="check">
            <input type="checkbox" checked={settings.rewriteFullScript} onChange={(e) => set({ rewriteFullScript: e.target.checked })} />
            <span>Cho phép AI viết lại kịch bản trước khi tạo video (mặc định giữ nguyên từng câu)</span>
          </label>
        )}
      </div>
      <div className="setting-group">
        <h3><Image /> Hình ảnh và khung video</h3>
        <Field label="Phong cách hình ảnh" hint={VISUAL_PRESET_OPTIONS.find((item) => item.id === settings.visualPreset)?.description ?? "Chọn phong cách hình ảnh cho các cảnh."}>
          <select value={settings.visualPreset} onChange={(e) => onChange(withVisualPreset(settings, e.target.value as ProjectSettings["visualPreset"]))}>
            {VISUAL_PRESET_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Mô tả nét hình" hint="Giữ nhân vật và chất liệu nhất quán giữa các cảnh. AI nhận cả phong cách ở trên và mô tả này.">
          <input value={settings.visualStyle} onChange={(e) => set({ visualStyle: e.target.value })} />
        </Field>
        <Field label="Kiểu khung" hint="Thẻ truyện: tiêu đề trên nền màu, tranh minh họa ở giữa, phụ đề bên dưới. Nhân vật trên nền giấy: một nhân vật chibi giữa tờ giấy kraft. Cả hai chỉ cho video dọc 9:16.">
          <select value={settings.layoutTemplate} onChange={(e) => onChange(withLayoutTemplate(settings, e.target.value as ProjectSettings["layoutTemplate"]))}>
            <option value="full-bleed">Toàn khung hình</option>
            <option value="story-card">Thẻ truyện (tranh minh họa)</option>
            <option value="paper-stage">Nhân vật trên nền giấy</option>
          </select>
        </Field>
        {settings.layoutTemplate === "story-card" && (
          <>
            <Field label="Màu thẻ truyện" hint="Nền xanh: tiêu đề vàng. Nền be: tiêu đề đỏ + trắng, phụ đề xanh lá chạy theo lời (kiểu Quy tắc cổ nhân).">
              <select value={settings.cardTheme} onChange={(e) => set({ cardTheme: e.target.value as ProjectSettings["cardTheme"] })}>
                <option value="blue">Nền xanh, tiêu đề vàng</option>
                <option value="sepia">Nền be, tiêu đề đỏ + trắng</option>
                <option value="blurred">Ảnh minh họa, nền mờ</option>
              </select>
            </Field>
            <Field label="Tiêu đề trên khung" hint="Để trống: AI chọn câu mở đầu hấp dẫn từ kịch bản. Nền be: gõ “DÒNG ĐỎ | DÒNG TRẮNG” để tự chia hai dòng.">
              <input maxLength={80} value={settings.cardTitle} onChange={(e) => set({ cardTitle: e.target.value })} />
            </Field>
            <Field label="Tên kênh ở chân video" hint="Để trống nếu không muốn hiện chân video.">
              <input maxLength={60} value={settings.brandName} onChange={(e) => set({ brandName: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Tỷ lệ">
          <select value={settings.aspectRatio} onChange={(e) => set({ aspectRatio: e.target.value as ProjectSettings["aspectRatio"] })}>
            <option>9:16</option>
            <option>1:1</option>
            <option>16:9</option>
          </select>
        </Field>
        <Field label="Tốc độ tạo ảnh" hint="Fast: 2 bước · Balanced: 4 bước · Quality: 8 bước SDXL-Turbo; Quality giảm lỗi khuôn mặt và tay.">
          <select value={settings.generationPreset ?? "balanced"} onChange={(e) => set({ generationPreset: e.target.value as ProjectSettings["generationPreset"] })}>
            <option value="fast">Fast — nhanh nhất</option>
            <option value="balanced">Balanced — khuyên dùng</option>
            <option value="quality">Quality — chất lượng cao</option>
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={settings.allowUploads} onChange={(e) => set({ allowUploads: e.target.checked })} />
          <span>Cho phép dùng ảnh tự tải lên</span>
        </label>
        <p className="microcopy">Đổi kiểu khung, màu hay tỷ lệ xong hãy bấm Tạo video lại để áp dụng cho video đã có.</p>
      </div>
      {frameExtra}
      <div className="setting-group">
        <h3><Mic2 /> Giọng đọc</h3>
        <Field label="Giọng tiếng Việt" hint={local ? voiceHint(settings.voice) : ""}>
          <select value={settings.voice} onChange={(e) => set({ voice: e.target.value })}>
            {local ? <>
              {!isVoicePreset(settings.voice) && <option value={settings.voice}>Giọng tiếng Việt trên máy</option>}
              {VOICE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </> : OPENAI_VOICES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </Field>
        {local && (
          <>
            <VoicePreview voice={settings.voice} engine={settings.localModels.tts} disabled={isDemo} />
            <LocalModelPicker catalog={localModels} value={settings.localModels} onChange={(next) => set({ localModels: next })} />
          </>
        )}
        <Field label="Tốc độ đọc">
          <input type="range" min="0.8" max="1.3" step="0.05" value={settings.voiceSpeed} onChange={(e) => set({ voiceSpeed: Number(e.target.value) })} />
          <small>{formatSpeed(settings.voiceSpeed)} · 1,00× là nhịp chuẩn video ngắn (~3,7 từ/giây)</small>
        </Field>
        <label className="check">
          <input type="checkbox" checked={settings.trimSilence} onChange={(e) => set({ trimSilence: e.target.checked })} />
          <span>Cắt khoảng lặng đầu/cuối giọng đọc</span>
        </label>
        {voiceExtra}
        <p className="microcopy">Cảnh đã có giọng đọc giữ nguyên; giọng mới áp dụng cho cảnh tạo mới.</p>
      </div>
      <div className="setting-group">
        <h3><Music2 /> Nhạc và âm thanh</h3>
        <label className="check">
          <input type="checkbox" checked={settings.autoMusic} onChange={(e) => set({ autoMusic: e.target.checked })} />
          <span>Nhạc nền êm tự tạo (không lo bản quyền)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.sceneSfx} onChange={(e) => set({ sceneSfx: e.target.checked })} />
          <span>Âm “tích” nhẹ mỗi lần chuyển cảnh</span>
        </label>
        {musicExtra}
      </div>
      <div className="setting-group">
        <h3><Subtitles /> Phụ đề và giữ chân người xem</h3>
        <p className="microcopy">Chữ lấy đúng từ kịch bản, thời điểm lấy từ giọng đọc thực tế.</p>
        <label className="check">
          <input type="checkbox" checked={settings.subtitle.enabled} onChange={(e) => setSubtitle({ enabled: e.target.checked })} />
          <span>Chèn phụ đề vào video</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.captionHighlight} disabled={!settings.subtitle.enabled} onChange={(e) => set({ captionHighlight: e.target.checked })} />
          <span>Phụ đề sáng dần theo từng từ (kiểu karaoke)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.hookTitle && hookAllowed} disabled={!hookAllowed} onChange={(e) => set({ hookTitle: e.target.checked })} />
          <span>Tiêu đề lớn ở 3 giây đầu{hookAllowed ? "" : " (thẻ truyện đã có tiêu đề)"}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.progressBar} onChange={(e) => set({ progressBar: e.target.checked })} />
          <span>Thanh tiến độ ở chân video (giữ người xem đến cuối)</span>
        </label>
        <Field label="Lời kêu gọi cuối video" hint="Hiện mờ dần ở 3 giây cuối, ví dụ “Theo dõi để xem thêm”. Để trống nếu không cần.">
          <input maxLength={60} value={settings.outroText} onChange={(e) => set({ outroText: e.target.value })} />
        </Field>
        {subtitleExtra}
      </div>
    </>
  );
}

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
  const [inputMode, setInputMode] = useState<Project["inputMode"]>("idea");
  // A finished script pasted into "Một ý tưởng" is switched to "Kịch bản có sẵn" (so it is read as written, not rewritten);
  // once the person has picked a mode themselves, that choice is never overridden.
  const [modeChosen, setModeChosen] = useState(false);
  const [autoScript, setAutoScript] = useState(false);
  const [settings, setSettings] = useState<ProjectSettings>(
    // 1.0x is already the short-form pace: the voice bridge brings every voice to about 3.7 words per second.
    { ...DEFAULT_PROJECT_SETTINGS, textProvider: "ollama", mediaProvider: "local", voice: DEFAULT_VOICE_PRESET, autoMusic: true, captionHighlight: true, hookTitle: true },
  );
  const [channelPreset, setChannelPreset] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  // Read the real local catalog even before Advanced is opened so a ready LTX node can
  // be selected automatically for new projects. When LTX is offline, the catalog's
  // video default stays null and the existing still-image fallback remains unchanged.
  const localModels = useLocalModels(isDemo);
  useEffect(() => {
    const defaultVideo = localModels?.video.default;
    if (!defaultVideo) return;
    setSettings((current) => current.localModels.video
      ? current
      : { ...current, localModels: { ...current.localModels, video: defaultVideo } });
  }, [localModels]);
  const submitting = useRef(false);
  // Pasted subtitles are read without their cue numbers and timings, so count only what will be spoken.
  const pastedSubtitles = looksLikeSubtitles(sourceText);
  const spokenText = (() => { try { return cleanScriptForNarration(sourceText); } catch { return ""; } })();
  const wordCount = spokenText.trim() ? spokenText.trim().split(/\s+/u).length : 0;
  // A script is read as written, so its length is known now; an idea is written to the chosen duration.
  const readsAsWritten = inputMode === "full-script";
  const narrationSeconds = estimatedNarrationSeconds(wordCount, settings.voice, settings.voiceSpeed);
  /** How many scenes a script read as written will be cut into: the same cuts the studio makes. */
  const sceneCount = useMemo(() => {
    if (!readsAsWritten || !spokenText.trim()) return null;
    try { return splitScript(spokenText).length; } catch { return null; }
  }, [readsAsWritten, spokenText]);
  const plan = contentPlan(settings.targetDurationSec, settings.style, settings.voice, settings.voiceSpeed);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (sourceText.trim().length < 10) { setError(SOURCE_TOO_SHORT); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createVideo({ sourceText, inputMode, settings });
      navigate(`/studio/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa thể bắt đầu tạo video. Hãy thử lại.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  /** Makes the project, cuts the script into scenes and stops there, so the scenes can be read and edited before any picture or voice is made. */
  async function splitFirst() {
    if (submitting.current) return;
    if (sourceText.trim().length < 10) { setError(SOURCE_TOO_SHORT); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const title = spokenText.trim().split(/[\n.!?]/u)[0]?.slice(0, 120) || "Video mới";
      const project = await api.createProject({ title, sourceText, inputMode, settings });
      try {
        await api.queue(project.id, "storyboard");
      } catch (e) {
        // The draft exists; the studio opens on it and says what is missing, instead of the script being lost.
        navigate(`/studio/${project.id}`, { state: { notice: e instanceof Error ? e.message : "Chưa chia được cảnh." } });
        return;
      }
      navigate(`/studio/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa chia được cảnh. Hãy thử lại; kịch bản của bạn vẫn còn nguyên.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function saveDraft() {
    if (submitting.current) return;
    if (sourceText.trim().length < 10) { setError(SOURCE_TOO_SHORT); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const title = spokenText.trim().split(/[\n.!?]/u)[0]?.slice(0, 120) || "Video mới";
      const project = await api.createProject({
        title,
        sourceText,
        inputMode,
        settings,
      });
      navigate(`/studio/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa lưu được bản nháp. Hãy thử lại; nội dung bạn nhập vẫn còn trên trang.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="page narrow">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={17} /> Quay lại
      </button>
      <div className="page-heading">
        <div>
          <h1>Kịch bản của bạn, video hoàn chỉnh.</h1>
          <p>Studio tự chia cảnh, tạo ảnh, đọc tiếng Việt, đồng bộ phụ đề và ghép video.</p>
        </div>
      </div>
      <form className="creation-form" onSubmit={submit}>
        <section>
          <div className="mode-switch">
            <span className="mode-switch-label" id="mode-switch-label">Bạn bắt đầu từ đâu?</span>
            <div
              className="mode-switch-options"
              role="radiogroup"
              aria-labelledby="mode-switch-label"
              onKeyDown={(event) => {
                // Radio group keyboard pattern: arrows move between the two options and select them.
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || busy) return;
                event.preventDefault();
                const next = inputMode === "idea" ? "full-script" : "idea";
                setInputMode(next);
                setModeChosen(true);
                setAutoScript(false);
                event.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus();
              }}
            >
              {([
                ["idea", "Một ý tưởng", "AI viết kịch bản, chia cảnh và vẽ minh họa"],
                ["full-script", "Kịch bản có sẵn", "Giữ nguyên lời bạn viết, dán được cả phụ đề .srt"],
              ] as const).map(([mode, title, detail]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={inputMode === mode}
                  tabIndex={inputMode === mode ? 0 : -1}
                  data-mode={mode}
                  className={inputMode === mode ? "active" : ""}
                  disabled={busy}
                  onClick={() => { setInputMode(mode); setModeChosen(true); setAutoScript(false); }}
                >
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </button>
              ))}
            </div>
          </div>
          <Field
            label={inputMode === "idea" ? "Ý tưởng hoặc chủ đề" : "Kịch bản hoàn chỉnh"}
            hint={inputMode === "idea"
              ? "Một câu chủ đề, vài ý chính hay cả một câu chuyện dài: AI viết lại thành lời đọc vừa đúng thời lượng bạn chọn bên dưới."
              : "Giữ nguyên câu chữ và dấu tiếng Việt. Có thể dán cả nội dung phụ đề (.srt/.vtt): số thứ tự và mốc thời gian được bỏ, chỉ đọc phần lời."}
          >
            <>
              <textarea
                aria-label={inputMode === "idea" ? "Ý tưởng hoặc chủ đề" : "Kịch bản hoàn chỉnh"}
                aria-invalid={error === SOURCE_TOO_SHORT || undefined}
                aria-describedby={error === SOURCE_TOO_SHORT ? "create-error" : undefined}
                value={sourceText}
                onChange={(e) => {
                  setSourceText(e.target.value);
                  if (error === SOURCE_TOO_SHORT) setError(null);
                  // Subtitles are someone's finished lines: read them as written, never rewrite them as an idea.
                  if (looksLikeSubtitles(e.target.value)) setInputMode("full-script");
                  else if (!modeChosen && inputMode === "idea" && looksLikeFinishedScript(e.target.value)) {
                    setInputMode("full-script");
                    setAutoScript(true);
                  } else if (autoScript && !looksLikeFinishedScript(e.target.value)) {
                    setInputMode("idea"); // the text changed into something that is no longer a finished script
                    setAutoScript(false);
                  }
                }}
                maxLength={30000}
                rows={10}
                disabled={busy}
                placeholder={inputMode === "idea" ? "Ví dụ: Vì sao cần xác minh tin nhắn chuyển tiền trước khi bấm chuyển…" : "Dán toàn bộ lời đọc cho video vào đây…"}
              />
              <div className="script-meta" aria-live="polite">
                <span>{sourceText.length.toLocaleString("vi-VN")} / 30.000 ký tự</span>
                <span>{wordCount.toLocaleString("vi-VN")} từ</span>
                {readsAsWritten && wordCount > 0 && <span>≈ {formatDuration(narrationSeconds * 1000)} lời đọc</span>}
                {sceneCount !== null && <span>≈ {sceneCount} cảnh</span>}
              </div>
              {autoScript && inputMode === "full-script" && !pastedSubtitles && (
                <Notice tone="info">
                  <span>
                    Đây là kịch bản hoàn chỉnh nên Studio giữ nguyên từng câu bạn viết và chia cảnh theo các dòng của bạn{sceneCount ? ` (khoảng ${sceneCount} cảnh)` : ""}, thay vì để AI viết lại.
                  </span>
                  <Button variant="ghost" type="button" onClick={() => { setInputMode("idea"); setModeChosen(true); setAutoScript(false); }}>Để AI viết lại theo thời lượng</Button>
                </Notice>
              )}
              {pastedSubtitles && <Notice tone="info">Đã nhận nội dung phụ đề: bỏ số thứ tự và mốc thời gian, nối các dòng thành câu và đọc nguyên văn.</Notice>}
              {readsAsWritten && narrationSeconds > 90 && (
                <Notice tone="warn">Video sẽ dài khoảng {formatDuration(narrationSeconds * 1000)}. Shorts, Reels và TikTok giữ chân tốt nhất dưới 60–90 giây: nên chia thành nhiều phần (Phần 1, Phần 2…).</Notice>
              )}
            </>
          </Field>
          {inputMode === "idea" && (
            <div className="duration-picker">
              <span className="duration-picker-label" id="duration-label">Thời lượng video</span>
              <div className="duration-options" role="radiogroup" aria-labelledby="duration-label">
                {DURATION_OPTIONS.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    role="radio"
                    aria-checked={settings.targetDurationSec === seconds}
                    className={settings.targetDurationSec === seconds ? "active" : ""}
                    disabled={busy}
                    onClick={() => setSettings((s) => ({ ...s, targetDurationSec: seconds }))}
                  >
                    {durationLabel(seconds)}
                  </button>
                ))}
              </div>
              <div className="duration-plan" aria-live="polite">
                <strong>Dàn ý AI sẽ viết: {plan.summary}</strong>
                <span>Khoảng {plan.words.target} từ lời đọc · {plan.scenes} cảnh · theo giọng và thể loại đang chọn</span>
                <details>
                  <summary>Xem dàn ý chi tiết</summary>
                  <ol>
                    {plan.beats.map((beat) => <li key={beat.label}><b>{beat.label}</b> · {beat.words} từ: {beat.brief}</li>)}
                  </ol>
                </details>
              </div>
              {settings.targetDurationSec > 90 && (
                <small className="duration-note">Shorts, Reels và TikTok giữ chân tốt nhất dưới 60–90 giây; video dài hợp với YouTube hoặc chia thành nhiều phần.</small>
              )}
            </div>
          )}
          <div className="channel-presets" role="radiogroup" aria-label="Mẫu kênh">
            <span className="channel-presets-label">Mẫu kênh</span>
            {CHANNEL_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={channelPreset === preset.id}
                className={channelPreset === preset.id ? "active" : ""}
                title={preset.hint}
                disabled={busy}
                onClick={() => { setChannelPreset(preset.id); setSettings((s) => preset.apply(s)); }}
              >
                {preset.label}
              </button>
            ))}
            {channelPreset && <small>{CHANNEL_PRESETS.find((preset) => preset.id === channelPreset)?.hint}</small>}
          </div>
          <div className="creation-defaults">
            <span><Video size={15} /> Video dọc 1080 × 1920</span>
            <span><Mic2 size={15} /> Giọng tiếng Việt</span>
            <span><Subtitles size={15} /> Phụ đề rõ nét</span>
          </div>
          {error && <Notice tone="bad" id="create-error">{error}</Notice>}
          {isDemo && <Notice tone="warn">{DEMO_ONLY}</Notice>}
        </section>
        <section>
          <button className="advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
            Tùy chọn video {advanced ? <ChevronUp /> : <ChevronDown />}
          </button>
        </section>
        <section hidden={!advanced}>
          <div className="video-options">
            <VideoOptions
              settings={settings}
              onChange={setSettings}
              scriptMode={inputMode}
              isDemo={isDemo}
              capabilities={null}
              localModels={localModels}
            />
            <p className="microcopy">Các lựa chọn này giống hệt mục “Tùy chọn” trong Studio sau khi tạo: bạn đổi ở đâu cũng được.</p>
          </div>
        </section>
        <div className="form-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void saveDraft()}>
            <Save size={17} /> Lưu bản nháp
          </Button>
          <Button type="button" variant="secondary" disabled={busy || isDemo} onClick={() => void splitFirst()} title="Chia kịch bản thành cảnh để đọc và sửa từng cảnh, chưa tạo ảnh hay giọng">
            <WandSparkles size={17} /> Chia cảnh để sửa trước
          </Button>
          <Button type="submit" busy={busy} disabled={isDemo}>
            <Clapperboard size={18} /> Tạo video
          </Button>
        </div>
        <p className="creation-footnote">
          {settings.textProvider === "ollama" && settings.mediaProvider === "local"
            ? "Xử lý trên máy đã kết nối, không gọi API trả phí. Máy cần bật trong lúc tạo video."
            : "Video sẽ sử dụng API trả phí đã chọn; hãy bảo đảm khóa API và hạn mức tài khoản đã sẵn sàng."}
        </p>
      </form>
    </div>
  );
}

function SceneCard({
  scene,
  selected,
  isLast,
  handDrawn,
  onSelect,
  onChange,
  onDelete,
  onMove,
  onUpload,
  onRegenerate,
  onUploadAnnotation,
  onDownloadImage,
  onClearAnnotation,
}: {
  scene: Scene;
  selected: boolean;
  isLast: boolean;
  handDrawn: boolean;
  onSelect(): void;
  onChange(next: Scene): void;
  onDelete(): void;
  onMove(direction: -1 | 1): void;
  onUpload(file: File, kind: "image" | "audio"): void;
  onRegenerate(component?: RegenerationComponent): void;
  onUploadAnnotation(file: File): void;
  onDownloadImage?(): void;
  onClearAnnotation?(): void;
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
        <label className="scene-prompt">
          <span>Mô tả ảnh</span>
          <textarea
            rows={2}
            aria-label={`Mô tả ảnh cảnh ${scene.order + 1}`}
            value={scene.imagePrompt}
            onChange={(e) => onChange({ ...scene, imagePrompt: e.target.value })}
          />
        </label>
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
          {handDrawn && scene.annotationJson !== null && <span className="media-state ready">Vùng vẽ riêng ✓</span>}
          <div>
            <button
              type="button"
              className="scene-regenerate"
              title="Tạo lại ảnh, giọng đọc và phụ đề của cảnh này"
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate();
              }}
            >
              <RefreshCw /> Tạo lại
            </button>
            <SceneMoreMenu
              scene={scene}
              isLast={isLast}
              handDrawn={handDrawn}
              onDelete={onDelete}
              onMove={onMove}
              onUpload={onUpload}
              onRegenerate={onRegenerate}
              onUploadAnnotation={onUploadAnnotation}
              onDownloadImage={onDownloadImage}
              onClearAnnotation={onClearAnnotation}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/** The less frequent scene actions, behind one "⋯" button so a card shows its text and two actions. */
function SceneMoreMenu({
  scene,
  isLast,
  handDrawn,
  onDelete,
  onMove,
  onUpload,
  onRegenerate,
  onUploadAnnotation,
  onDownloadImage,
  onClearAnnotation,
}: {
  scene: Scene;
  isLast: boolean;
  handDrawn: boolean;
  onDelete(): void;
  onMove(direction: -1 | 1): void;
  onUpload(file: File, kind: "image" | "audio"): void;
  onRegenerate(component?: RegenerationComponent): void;
  onUploadAnnotation(file: File): void;
  onDownloadImage?: (() => void) | undefined;
  onClearAnnotation?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const number = scene.order + 1;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".scene-menu-trigger")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    root.current?.querySelector(".scene-menu-list")?.scrollIntoView({ block: "nearest" });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const item = (label: string, action: () => void, disabled = false, danger = false) => (
    <button
      type="button"
      className={danger ? "danger" : undefined}
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        action();
      }}
    >
      {label}
    </button>
  );
  const upload = (label: string, accept: string, handle: (file: File) => void) => (
    <label className="scene-menu-upload">
      {label}
      <input
        type="file"
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handle(file);
          e.target.value = "";
          setOpen(false);
        }}
      />
    </label>
  );
  return (
    <div className="scene-menu" ref={root} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="scene-menu-trigger"
        aria-label={`Thao tác khác cho cảnh ${number}`}
        title="Thao tác khác"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal />
      </button>
      {open && (
        <div className="scene-menu-list">
          <span>Tạo lại riêng</span>
          {item("Ảnh", () => onRegenerate("image"), !scene.audioPath || !scene.actualDurationMs)}
          {item("Giọng đọc và phụ đề", () => onRegenerate("audio"), !scene.imagePath)}
          {item("Đồng bộ lại phụ đề", () => onRegenerate("subtitles"), !scene.imagePath || !scene.audioPath)}
          <span>Dùng file của bạn</span>
          {upload("Tải ảnh thay thế…", "image/jpeg,image/png,image/webp", (file) => onUpload(file, "image"))}
          {upload("Tải audio lời đọc…", "audio/mpeg,audio/wav,audio/mp4,audio/aac", (file) => onUpload(file, "audio"))}
          {scene.imagePath && onDownloadImage && item("Tải ảnh cảnh về máy", onDownloadImage)}
          {handDrawn && (
            <>
              <span>Vẽ tay (nâng cao)</span>
              {item("Chia vùng vẽ theo thứ tự…", () => navigate("/whiteboard"))}
              {upload(scene.annotationJson !== null ? "Thay file vùng vẽ (JSON)…" : "Tải file vùng vẽ (JSON)…", "application/json,.json", onUploadAnnotation)}
              {scene.annotationJson !== null && onClearAnnotation && item("Bỏ vùng vẽ riêng, vẽ toàn cảnh", onClearAnnotation)}
            </>
          )}
          <span>Sắp xếp</span>
          {item("Đưa lên", () => onMove(-1), scene.order === 0)}
          {item("Đưa xuống", () => onMove(1), isLast)}
          {item("Xóa cảnh", () => {
            void askConfirm({
              title: `Xóa cảnh ${number}?`,
              detail: "Lời đọc, ảnh và giọng của cảnh này sẽ mất.",
              confirmLabel: "Xóa cảnh",
              tone: "danger",
            }).then((yes) => { if (yes) onDelete(); });
          }, false, true)}
        </div>
      )}
    </div>
  );
}

function StudioPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDemo } = useAuth();
  const localModels = useLocalModels(isDemo);
  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState(0);
  const [sourceDraft, setSourceDraft] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Phones show the scene list or the preview, not both stacked; a finished video opens on the preview.
  const [phoneTab, setPhoneTab] = useState<"scenes" | "preview" | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [saveState, setSaveState] = useState<SaveState>({ status: "saved" });
  const saved = saveState.status === "saved";
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // Two ways to keep a script safe: saved by itself a moment after each edit (default), or only when the person presses Save.
  // The choice belongs to the person's browser, not to the project.
  const [autoSave, setAutoSave] = useState(() => {
    try { return localStorage.getItem("studio.autosave") !== "off"; } catch { return true; }
  });
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoNote, setLogoNote] = useState<string | null>(null);
  const demoLogoUrl = useRef<string | null>(null);
  // Layout mode: the preview shows the scene picture (not the finished MP4) with the logo ready to drag.
  const [layoutEditing, setLayoutEditing] = useState(false);
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
  // Writes edits in order, on the newest stamp, and carries them over a server-side change (see lib/project-saver.ts).
  const saver = useRef<ProjectSaver | null>(null);
  saver.current ??= new ProjectSaver({
    save: (next) => api.updateProject(next),
    load: () => api.getProject(id),
    onSaved: (updated) => setProject(updated),
    onState: (state) => { setSaveState(state); if (state.status === "saved") setSavedAt(new Date()); },
  });
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
        saver.current?.confirm(p);
        setProject(p);
        setSourceDraft(p.sourceText);
        setJobs(j);
        if (account) setCapabilities(account.capabilities);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Chưa mở được dự án. Có thể dự án đã bị xóa; quay lại danh sách để kiểm tra."),
      );
  }, [id, isDemo]);
  useEffect(() => {
    if (isDemo || !processing) return;
    let refreshing = false;
    let active = true;
    const refresh = () => {
      if (refreshing) return;
      refreshing = true;
      void Promise.all([api.getJobs(id), api.getProject(id)])
        .then(([nextJobs, nextProject]) => {
          if (!active) return;
          setJobs(nextJobs);
          saver.current?.confirm(nextProject);
          setProject(nextProject);
          setSourceDraft(nextProject.sourceText);
          setError(null);
        })
        .catch(() => active && setError("Tạm mất kết nối. Việc đang chạy vẫn tiếp tục trên máy; trang sẽ tự cập nhật khi có mạng lại."))
        .finally(() => { refreshing = false; });
    };
    // Refresh immediately after a job starts or the page is reopened; every 4 s is enough for a job that takes
    // minutes and keeps the studio far below the API rate limit.
    refresh();
    const timer = window.setInterval(refresh, 4000);
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
  // "Lời đọc gốc" always shows the script the scenes spell out, so an edit made in a scene shows there at once.
  useEffect(() => { if (project) setSourceDraft(project.sourceText); }, [project?.sourceText]);
  // Sign the preview only when the picture itself changes: every status refresh replaces `project.scenes`, and
  // re-signing on each one (a request every 2 s) pushed the studio into the API's rate limit (HTTP 429).
  const activeImagePath = project?.scenes[selected]?.imagePath ?? null;
  useEffect(() => {
    const path = activeImagePath;
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
  }, [id, isDemo, activeImagePath]);
  useEffect(() => {
    const path = project?.settings.logoPath;
    if (!path || isDemo) {
      // the demo keeps a chosen logo in the browser only (see uploadLogo)
      setLogoPreviewUrl(isDemo && path ? demoLogoUrl.current : null);
      return;
    }
    let active = true;
    void api.mediaUrl(id, path)
      .then(({ url }) => active && setLogoPreviewUrl(url))
      .catch(() => active && setLogoPreviewUrl(null));
    return () => { active = false; };
  }, [id, isDemo, project?.settings.logoPath]);
  function change(next: Project) {
    if (locked.current) return;
    setProject(next);
    saver.current?.edit(next, autoSaveRef.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (autoSaveRef.current) saveTimer.current = window.setTimeout(() => void flushEdits().catch(() => {}), 700);
  }
  function chooseAutoSave(on: boolean) {
    setAutoSave(on);
    autoSaveRef.current = on;
    try { localStorage.setItem("studio.autosave", on ? "on" : "off"); } catch { /* a private window: the choice lasts for this visit */ }
    if (on) void flushEdits().catch(() => {}); // edits waiting for Save are written as soon as auto-save is turned on
    else {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (saver.current?.hasPending) setSaveState({ status: "unsaved" });
    }
  }
  // Leaving with edits that were never written would lose them: the browser asks first.
  useEffect(() => {
    if (saveState.status === "saved") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState.status]);
  /** Writes every queued edit; throws (and shows the reason beside the title) when it cannot. */
  async function flushEdits() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await saver.current?.flush();
  }
  useSaveShortcut(() => flushEdits().catch(() => {}));
  async function createVideo() {
    if (locked.current) return;
    if (isDemo) { setError(DEMO_ONLY); return; }
    if (sourceDraft.trim().length < 10) { setError("Kịch bản cần ít nhất 10 ký tự trước khi tạo video."); return; }
    if (project && sourceDraft !== project.sourceText) {
      setError("Bạn đã sửa “Lời đọc gốc” nhưng chưa bấm “Áp dụng”. Hãy áp dụng (chia lại cảnh) hoặc hủy thay đổi trước khi tạo video.");
      return;
    }
    locked.current = true;
    setBusyAction("create_video");
    setError(null);
    try {
      await flushEdits();
      const job = await api.continueVideo(id);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa bắt đầu tạo video được. Kiểm tra máy chính đang bật rồi bấm lại.");
    } finally { setBusyAction(null); }
  }
  /** Stops the running job at its next step; the scenes already made are kept and the project goes back to a draft. */
  async function cancelActiveJob() {
    const job = jobs.find((item) => item.status === "queued" || item.status === "running");
    if (!job || busyAction) return;
    if (!(await askConfirm({
      title: "Dừng tạo video?",
      detail: "Cảnh đã làm xong vẫn được giữ. Bấm Tạo video để làm tiếp phần còn lại.",
      confirmLabel: "Dừng",
      cancelLabel: "Tiếp tục chạy",
      tone: "danger",
    }))) return;
    setBusyAction("cancel");
    setError(null);
    try {
      const cancelled = await api.cancelJob(job.id);
      setJobs((current) => current.map((item) => (item.id === cancelled.id ? cancelled : item)));
      const [nextJobs, nextProject] = await Promise.all([api.getJobs(id), api.getProject(id)]);
      setJobs(nextJobs);
      saver.current?.confirm(nextProject);
      setProject(nextProject);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa dừng được. Hãy bấm Dừng lần nữa.");
    } finally {
      setBusyAction(null);
    }
  }
  async function applySourceDraft() {
    if (!project || sourceDraft === project.sourceText) return;
    if (sourceDraft.trim().length < 10) { setError("Kịch bản cần ít nhất 10 ký tự. Nội dung cũ vẫn được giữ."); return; }
    if (project.scenes.length && !(await askConfirm({
      title: "Chia lại toàn bộ cảnh?",
      detail: "Các cảnh hiện có, kể cả phần bạn đã sửa và ảnh, giọng đã tạo, sẽ được thay bằng cảnh mới.",
      confirmLabel: "Chia lại",
      cancelLabel: "Giữ cảnh cũ",
      tone: "danger",
    }))) return;
    setError(null);
    setSelected(0);
    setResult(null);
    change({ ...project, sourceText: sourceDraft, inputMode: "full-script", scenes: [], status: "draft" });
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
      setError(e instanceof Error ? e.message : "Chưa tải được video. Hãy thử lại.");
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
      ...(imageChanged ? { imagePath: null, videoPath: null, mediaStatus: "pending" as const } : {}),
    };
    change(withScriptFromScenes({ ...project, scenes, status: "draft" }));
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
    change(withScriptFromScenes({ ...project, scenes }));
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
      videoPath: null,
      audioPath: null,
      thumbnailUrl: null,
      mediaStatus: "pending",
      errorMessage: null,
      annotationJson: null,
      subtitles: [],
    };
    change(withScriptFromScenes({ ...project, scenes: [...project.scenes, scene] }));
    setSelected(project.scenes.length);
  }
  function deleteScene(index: number) {
    if (!project) return;
    const scenes = project.scenes
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, order: i }));
    change(withScriptFromScenes({ ...project, scenes }));
    setSelected(Math.max(0, index - 1));
  }
  async function runAction(
    type: "storyboard" | "generate_media" | "render_video" | "render_whiteboard",
  ) {
    if (locked.current) return;
    if (isDemo) {
      setError(
        type === "storyboard"
          ? "Chế độ mẫu chưa gọi AI. Anh vẫn có thể thêm, xóa và sửa từng cảnh thủ công."
          : DEMO_ONLY,
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
          ? Boolean(project?.settings.mediaProvider === "openai" ? capabilities?.openai : capabilities?.localMedia)
          : true;
    if (!requestedAiEnabled) {
      setError(
        type === "storyboard"
          ? project?.settings.textProvider === "ollama"
            ? "Chưa kết nối Ollama cho phần kịch bản."
            : `Chưa có khóa API ${project?.settings.textProvider === "anthropic" ? "Claude" : "OpenAI"}. Hãy dán khóa của bạn ở Cài đặt (mục Dịch vụ trả phí), hoặc chọn Ollama trong Tùy chọn.`
          : project?.settings.mediaProvider === "openai"
            ? "Chưa có khóa API OpenAI để tạo ảnh, giọng đọc và đồng bộ phụ đề. Hãy dán khóa của bạn ở Cài đặt (mục Dịch vụ trả phí), hoặc chọn media trên máy trong Tùy chọn."
            : "Máy tạo ảnh và giọng đọc trên máy chưa được kết nối. Anh vẫn có thể tải media của mình lên.",
      );
      return;
    }
    if (type === "render_video" && !capabilities?.render) {
      setError("Máy ghép video chưa sẵn sàng. Xem trạng thái ở trang Hệ thống.");
      return;
    }
    setBusyAction(type);
    locked.current = true;
    setError(null);
    try {
      await flushEdits();
      if (type === "generate_media") {
        const estimate = await api.estimate(id);
        const accepted = estimate.estimatedUsd === 0 || await askConfirm({
          title: `Tạo ${estimate.imageCount} ảnh tốn khoảng ${formatUsd(estimate.estimatedUsd)}?`,
          detail: "Đây là ước tính; số tiền thật do nhà cung cấp tính trên tài khoản của bạn.",
          confirmLabel: "Tạo ảnh và giọng",
          cancelLabel: "Để sau",
        });
        if (!accepted) return;
      }
      const job = await api.queue(id, type);
      setJobs((j) => [job, ...j]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa bắt đầu được. Kiểm tra máy chính đang bật rồi bấm lại.");
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
        "Chế độ mẫu không lưu file bạn tải lên. Tải ảnh và giọng cần máy chính đang bật.",
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
        ...(kind === "image" ? { imagePath: path, videoPath: null } : { audioPath: path }),
        ...(kind === "audio" ? { actualDurationMs: null, subtitles: [] } : {}),
        mediaStatus: "pending",
        errorMessage: null,
      };
      const next = { ...project, scenes: project.scenes.map((item, sceneIndex) => sceneIndex === index ? updatedScene : item), status: "draft" as const };
      setProject(next);
      saver.current?.edit(next);
      await flushEdits();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa tải file lên được. Hãy thử lại hoặc chọn file khác.");
    } finally {
      setBusyAction(null);
    }
  }
  async function uploadSceneAnnotation(sceneId: string, file: File) {
    if (!project) return;
    if (isDemo) {
      setError(DEMO_ONLY);
      return;
    }
    setError(null);
    try {
      const text = await file.text();
      const annotation = JSON.parse(text) as object;
      await api.updateSceneAnnotation(id, sceneId, annotation);
      setProject((p) => {
        if (!p) return p;
        return {
          ...p,
          scenes: p.scenes.map((s) =>
            s.id === sceneId ? { ...s, annotationJson: annotation } : s,
          ),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa tải được file vùng vẽ. File cần là JSON xuất từ công cụ Chia vùng vẽ.");
    }
  }
  async function clearSceneAnnotation(sceneId: string) {
    if (!project) return;
    setError(null);
    try {
      await api.clearSceneAnnotation(id, sceneId);
      setProject((p) => {
        if (!p) return p;
        return {
          ...p,
          scenes: p.scenes.map((s) =>
            s.id === sceneId ? { ...s, annotationJson: null } : s,
          ),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa bỏ được vùng vẽ riêng. Hãy thử lại.");
    }
  }
  async function downloadSceneImage(scene: Scene) {
    if (!scene.imagePath) return;
    setError(null);
    try {
      const { url } = await api.mediaUrl(id, scene.imagePath);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scene-${scene.order + 1}.jpg`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa tải ảnh lên được. Hãy dùng ảnh JPG hoặc PNG rồi thử lại.");
    }
  }
  async function regenerate(sceneId: string, component: RegenerationComponent = "all") {
    if (isDemo) {
      setError("Tạo lại cảnh cần máy tạo ảnh đang bật hoặc khóa OpenAI trong Cài đặt.");
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
        !(await askConfirm({
          title: `Tạo lại cảnh này tốn khoảng ${formatUsd(estimate.estimatedUsd / Math.max(1, estimate.imageCount))}?`,
          detail: "Đây là ước tính; số tiền thật do nhà cung cấp tính trên tài khoản của bạn.",
          confirmLabel: "Tạo lại cảnh",
          cancelLabel: "Để sau",
        }))
      )
        return;
      const job = await api.regenerateScene(id, sceneId, component);
      setJobs((current) => [job, ...current]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa tạo lại được cảnh. Hãy thử lại.");
    } finally {
      setBusyAction(null);
    }
  }
  async function playNarration() {
    if (!activeScene?.audioPath) {
      setError("Cảnh này chưa có giọng đọc. Bấm Tạo lại để tạo giọng.");
      return;
    }
    try {
      const { url } = await api.mediaUrl(id, activeScene.audioPath);
      await new Audio(url).play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa phát được giọng đọc của cảnh này. Bấm Tạo lại để làm lại giọng.");
    }
  }
  async function uploadMusic(file: File) {
    if (!project) return;
    if (locked.current) return;
    if (isDemo) {
      setError(DEMO_ONLY);
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
      saver.current?.edit(next);
      await flushEdits();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa tải nhạc lên được. Hãy thử lại hoặc chọn file khác.");
    } finally {
      setBusyAction(null);
    }
  }
  async function uploadLogo(file: File) {
    if (!project) return;
    if (locked.current) return;
    if (file.size > LOGO_MAX_BYTES) {
      setError("Logo lớn hơn 5 MB. Hãy dùng ảnh nhỏ hơn (logo chỉ chiếm một góc nhỏ của video).");
      return;
    }
    if (isDemo) {
      // Demo: try the logo on the preview without uploading it anywhere.
      const round = await checkLogoFile(file);
      if (demoLogoUrl.current) URL.revokeObjectURL(demoLogoUrl.current);
      demoLogoUrl.current = URL.createObjectURL(file);
      setLogoPreviewUrl(demoLogoUrl.current);
      change({ ...project, settings: { ...project.settings, logoPath: "demo:logo", logoShape: round ? "circle" : "original" } });
      setLogoNote("Chế độ mẫu: logo chỉ hiện trên trang này để thử bố cục, không được tải lên.");
      return;
    }
    setBusyAction("logo");
    locked.current = true;
    setLogoNote(null);
    try {
      // A round logo saved on a white square would show as a box on the video: cut it to a circle, and say so.
      const round = await checkLogoFile(file);
      const path = await api.uploadMedia(id, file, "logo");
      const next = { ...project, settings: { ...project.settings, logoPath: path, logoShape: round ? "circle" as const : "original" as const } };
      if (round) setLogoNote("Logo có nền trắng quanh hình tròn nên đã được cắt tròn. Đổi lại ở “Hình dạng logo” nếu cần.");
      setProject(next);
      saver.current?.edit(next);
      await flushEdits();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa tải logo lên được. Hãy thử lại hoặc chọn ảnh khác.");
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
          : "Chưa chạy lại được. Hãy thử lại sau ít phút.",
      );
    } finally {
      setBusyAction(null);
    }
  }
  if (error && !project)
    return (
      <div className="page">
        <Notice tone="bad">{error}</Notice>
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
  const shownTab = phoneTab ?? (result ? "preview" : "scenes");
  // An idea is written to the chosen length: once the voices exist, show how close the real narration came.
  const voiced = project.scenes.length > 0 && project.scenes.every((scene) => scene.actualDurationMs);
  const targetCheck = project.inputMode === "idea" && voiced
    ? { off: Math.abs(totalMs / 1000 - project.settings.targetDurationSec) > project.settings.targetDurationSec * 0.15 }
    : null;
  return (
    <div className="studio">
      <div className="studio-top">
        <h1 className="sr-only">Studio: {project.title}</h1>
        <div className="studio-head">
          <button type="button" className="back-link" onClick={() => navigate("/")} aria-label="Về danh sách dự án">
            <ArrowLeft size={16} /> <span>Dự án</span>
          </button>
          <input
            className="studio-title"
            value={project.title}
            aria-label="Tên video"
            disabled={processing || Boolean(busyAction)}
            onChange={(e) => change({ ...project, title: e.target.value })}
          />
          {/* One line says where the edits are; saving by hand only shows up when it is needed. */}
          <span className={`save-state ${saveState.status === "error" ? "save-failed" : ""}`} role="status" aria-live="polite">
            {saveState.status === "saved" ? (
              <>
                <Check size={14} /> Đã lưu{savedAt ? ` ${savedAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}
              </>
            ) : saveState.status === "saving" ? (
              <>
                <LoaderCircle className="spin" size={14} /> Đang lưu
              </>
            ) : saveState.status === "unsaved" ? (
              <>
                <PenLine size={14} /> Chưa lưu
              </>
            ) : (
              <>
                <CircleAlert size={14} /> Chưa lưu được
              </>
            )}
            {(saveState.status === "error" || (!autoSave && saveState.status === "unsaved")) && (
              <button type="button" className="link-button" onClick={() => void flushEdits().catch(() => {})} title="Lưu ngay mọi chỉnh sửa (Ctrl/⌘ + S)">
                {saveState.status === "error" ? "Thử lại" : "Lưu ngay"}
              </button>
            )}
          </span>
        </div>
        <div className="studio-actions">
          <Button onClick={() => void createVideo()} busy={busyAction === "create_video"} disabled={processing || Boolean(busyAction)}>
            <Video size={17} /> {failedJob ? "Tiếp tục tạo video" : "Tạo video"}
          </Button>
          <Button variant="secondary" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}>
            <Settings size={17} /> Tùy chọn
          </Button>
          <details
            className="manual-actions"
            onKeyDown={(event) => {
              // Esc closes the menu and gives focus back to its button, like every other menu here
              if (event.key !== "Escape" || !event.currentTarget.open) return;
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }}
          >
            <summary aria-label="Thêm thao tác" title="Thêm thao tác"><MoreHorizontal size={18} /></summary>
            <div>
              <p className="menu-label">Chỉnh từng bước</p>
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
                : "Chế độ 0 đồng API: tải ảnh và audio của bạn lên"
            }
          >
            <Sparkles size={17} />
            Tạo media
          </Button>
          <Button
            variant="secondary"
            onClick={() => void runAction("render_video")}
            busy={busyAction === "render_video"}
            disabled={processing || Boolean(busyAction) || (!isDemo && (!project.scenes.length || !capabilities?.render))}
            title={!project.scenes.length ? "Hãy tạo ít nhất một cảnh trước" : undefined}
          >
            <Video size={17} /> Xuất video
          </Button>
              <p className="menu-label">Lưu</p>
              <Button
                variant="secondary"
                onClick={() => void flushEdits().catch(() => {})}
                disabled={saveState.status === "saved" || saveState.status === "saving"}
                title="Lưu ngay mọi chỉnh sửa (Ctrl/⌘ + S)"
              >
                <Save size={15} /> Lưu ngay
              </Button>
              <label className="check auto-save" title="Bật: tự lưu sau mỗi chỉnh sửa. Tắt: chỉ lưu khi bạn bấm Lưu (hoặc khi bấm Tạo video).">
                <input type="checkbox" checked={autoSave} onChange={(e) => chooseAutoSave(e.target.checked)} />
                <span>Tự động lưu</span>
              </label>
            </div>
          </details>
        </div>
      </div>
      {error && (
        <div className="studio-notice">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      {!isDemo && capabilities && zeroCostMode && (
        <div className="studio-notice">
          <Notice tone="info">
            Đang chạy chế độ 0 đồng API: bạn có thể tự viết storyboard, tải ảnh
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
          <p className="processing-hint">
            Có thể đóng hoặc tải lại trang. Studio sẽ tiếp tục theo dõi tác vụ đã lưu.{" "}
            <button type="button" className="link-button" onClick={() => void cancelActiveJob()} disabled={busyAction === "cancel"}>
              {busyAction === "cancel" ? "Đang dừng…" : "Dừng"}
            </button>
          </p>
        </div>
      )}
      {failedJob && !activeJob && (
        <div className="job-error">
          <div>
            <strong>{failedJob.stage}</strong>
            <span>
              {failedJob.errorMessage ??
                "Video chưa làm xong. Các cảnh đã xong vẫn được giữ."}
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
      <div className="studio-tabs" role="group" aria-label="Chọn phần hiển thị">
        <button type="button" aria-pressed={shownTab === "scenes"} onClick={() => setPhoneTab("scenes")}>
          Cảnh <span>{project.scenes.length}</span>
        </button>
        <button type="button" aria-pressed={shownTab === "preview"} onClick={() => setPhoneTab("preview")}>
          {result ? "Video" : "Xem trước"} {activeScene && !result && <span>Cảnh {selected + 1}</span>}
        </button>
      </div>
      <div className={`studio-grid ${optionsOpen ? "" : "studio-basic"} phone-${shownTab}`}>
        <section className="scene-panel">
          <div className="panel-heading">
            <div>
              <h2>Kịch bản & cảnh</h2>
              <span>
                {project.scenes.length} cảnh · {formatDuration(totalMs)}
                {targetCheck && (
                  <b className={targetCheck.off ? "duration-off" : "duration-ok"} title="Thời lượng lời đọc thật so với thời lượng bạn chọn khi tạo video">
                    {" "}/ mục tiêu {durationLabel(project.settings.targetDurationSec)}
                  </b>
                )}
              </span>
            </div>
            <button type="button" onClick={addScene} disabled={processing || Boolean(busyAction)}>
              <Plus size={17} /> Thêm cảnh
            </button>
          </div>
          <fieldset className="scene-editor" disabled={processing || Boolean(busyAction)}>
            <details className="source-editor">
              <summary>Kịch bản đầy đủ <ChevronDown size={16} /></summary>
              <label className="field">
                <span>Lời đọc gốc</span>
                <textarea value={sourceDraft} rows={7} maxLength={30000} onChange={(e) => setSourceDraft(e.target.value)} />
                <small>Luôn khớp với lời đọc của các cảnh bên dưới: sửa ở từng cảnh thì kịch bản này tự cập nhật và được lưu.</small>
              </label>
              {project && sourceDraft !== project.sourceText && (
                <Notice tone="warn">
                  <span>Sửa ở đây sẽ <b>chia lại toàn bộ cảnh</b> từ kịch bản mới; các cảnh, ảnh và giọng đã có sẽ bị thay.</span>
                  <Button type="button" variant="secondary" onClick={() => void applySourceDraft()}>Áp dụng và chia lại cảnh</Button>
                  <Button type="button" variant="ghost" onClick={() => setSourceDraft(project.sourceText)}>Hủy thay đổi</Button>
                </Notice>
              )}
            </details>
          {project.scenes.length === 0 ? (
            <div className="empty-scenes">
              <BookOpenText />
              <h3>Chưa có cảnh</h3>
              <p>
                {processing
                  ? "Studio đang chia kịch bản thành các cảnh. Cảnh thật sẽ xuất hiện khi bước này hoàn tất."
                  : "Chia cảnh trước để xem và sửa lời đọc từng cảnh, hoặc bấm Tạo video ở trên để studio làm một lèo từ đầu đến cuối."}
              </p>
              <Button
                onClick={() => void runAction("storyboard")}
                busy={busyAction === "storyboard"}
                disabled={processing || Boolean(busyAction) || (!isDemo && !storyboardEnabled)}
                title={storyboardEnabled ? "Chia kịch bản thành cảnh và viết mô tả ảnh; chưa tạo ảnh hay giọng" : "Chưa có máy hoặc khóa API để chia cảnh; hãy thêm cảnh thủ công"}
              >
                <WandSparkles size={17} /> Chia cảnh để chỉnh sửa
              </Button>
              <Button variant="secondary" onClick={addScene}>
                <Plus size={17} /> Thêm cảnh thủ công
              </Button>
            </div>
          ) : (
            <div className="scene-list">
              {project.status === "draft" && !processing && (
                <Notice tone="info">
                  Sửa lời đọc hoặc mô tả ảnh ngay trong từng ô; mọi thay đổi tự lưu. Xong bấm <b>Tạo video</b>: chỉ các cảnh bạn đã sửa được tạo lại ảnh và giọng, cảnh còn lại giữ nguyên.
                </Notice>
              )}
              {project.scenes.map((scene, index) => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  selected={index === selected}
                  isLast={index === project.scenes.length - 1}
                  handDrawn={drawsByHand(project.settings)}
                  onSelect={() => setSelected(index)}
                  onChange={(next) => updateScene(index, next)}
                  onDelete={() => deleteScene(index)}
                  onMove={(dir) => moveScene(index, dir)}
                  onUpload={(file, kind) => void uploadScene(index, file, kind)}
                  onRegenerate={(component) => void regenerate(scene.id, component)}
                  onUploadAnnotation={(file) => void uploadSceneAnnotation(scene.id, file)}
                  onClearAnnotation={() => void clearSceneAnnotation(scene.id)}
                  onDownloadImage={() => void downloadSceneImage(scene)}
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
              {result && !layoutEditing ? (
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
              {layoutEditing && <StageGuides settings={project.settings} />}
              {layoutEditing && (
                <button type="button" className="stage-done" onClick={() => setLayoutEditing(false)}>
                  <Check size={14} /> Xong
                </button>
              )}
              {logoPreviewUrl && (
                // Same place, size and look as in the MP4 (lib/logo.ts uses the export's own rule).
                <StageLogo
                  src={logoPreviewUrl}
                  settings={project.settings}
                  editing={layoutEditing}
                  onChange={(patch) => change({ ...project, settings: { ...project.settings, ...patch } })}
                />
              )}
              {project.settings.subtitle.enabled && activeScene && (
                <div
                  className={`subtitle-preview subtitle-${project.settings.subtitle.position}`}
                >
                  {activeScene.narration.slice(0, 70)}
                </div>
              )}
              {activeScene?.audioPath && <button type="button" className="preview-play" aria-label="Nghe lời đọc cảnh đang chọn" onClick={() => void playNarration()}>
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
          <PostCaptionCard project={project} />
          <div className="timeline">
            <div className="timeline-label">
              <span>Timeline</span>
              <small>
                Thời lượng cập nhật theo audio thật sau khi tạo giọng đọc
              </small>
            </div>
            <div className="timeline-track" role="group" aria-label="Chọn cảnh trên timeline">
              {project.scenes.map((s, i) => (
                <button
                  key={s.id}
                  className={i === selected ? "active" : ""}
                  aria-label={`Cảnh ${i + 1}, ${formatDuration(s.actualDurationMs ?? s.estimatedDurationMs)}`}
                  aria-current={i === selected ? "true" : undefined}
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
        <aside className="settings-panel" hidden={!optionsOpen} aria-label="Tùy chọn video">
          <div className="panel-heading">
            <h2>Thiết lập</h2>
          </div>
          <fieldset className="settings-scroll" disabled={processing || Boolean(busyAction)}>
            <VideoOptions
              settings={project.settings}
              onChange={(settings) => change({ ...project, settings })}
              scriptMode={project.inputMode}
              isDemo={isDemo}
              capabilities={capabilities}
              localModels={localModels}
              frameExtra={<>
            <div className="setting-group">
              <h3><Image /> Logo video</h3>
              <p className="microcopy">Logo được chèn lên mọi cảnh khi xuất MP4 và hiện ngay trên khung xem trước. Nên dùng PNG nền trong suốt, tối đa 5 MB.</p>
              {logoPreviewUrl && <img className={`logo-preview ${project.settings.logoShape === "circle" ? "is-circle" : ""}`} src={logoPreviewUrl} alt="Logo đang chọn" />}
              {logoNote && <Notice tone="info">{logoNote}</Notice>}
              <label className="button button-ghost file-button">
                <Upload size={16} />
                {project.settings.logoPath ? "Thay logo" : "Tải logo lên"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadLogo(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {project.settings.logoPath && (
                <>
                  <Button variant="danger" onClick={() => { setLogoNote(null); change({ ...project, settings: { ...project.settings, logoPath: null } }); }}>
                    Bỏ logo khỏi video
                  </Button>
                  <Field label="Vị trí logo">
                    <select
                      value={project.settings.logoPosition}
                      onChange={(e) => change({ ...project, settings: { ...project.settings, logoPosition: e.target.value as ProjectSettings["logoPosition"] } })}
                    >
                      <option value="top-center">Trên giữa</option>
                      <option value="top-left">Trên trái</option>
                      <option value="top-right">Trên phải</option>
                      <option value="bottom-left">Dưới trái</option>
                      <option value="bottom-right">Dưới phải</option>
                      <option value="custom">Tự do (kéo thả trên khung xem trước)</option>
                    </select>
                    {project.settings.layoutTemplate === "story-card" && project.settings.logoPosition !== "custom" && <small>Với khung Thẻ truyện, logo nằm ở góc của khung tranh, không đè lên tiêu đề và phụ đề.</small>}
                  </Field>
                  <Button
                    variant={layoutEditing ? "primary" : "secondary"}
                    aria-pressed={layoutEditing}
                    disabled={!logoPreviewUrl}
                    onClick={() => {
                      // on a phone the preview is a tab of its own: show it, the logo is dragged there
                      if (!layoutEditing) setPhoneTab("preview");
                      setLayoutEditing(!layoutEditing);
                    }}
                  >
                    <Move size={16} /> {layoutEditing ? "Xong, lưu vị trí" : "Kéo thả logo trên khung"}
                  </Button>
                  {layoutEditing && <small className="microcopy">Kéo logo tới chỗ muốn đặt, kéo góc dưới phải để đổi cỡ. Vùng sọc là nơi TikTok, Reels và Shorts che mất.</small>}
                  <Field label="Hình dạng logo" hint="Cắt tròn: dành cho logo hình tròn được lưu trên nền vuông (JPG nền trắng), để video không hiện ô vuông trắng.">
                    <select
                      value={project.settings.logoShape}
                      onChange={(e) => change({ ...project, settings: { ...project.settings, logoShape: e.target.value as ProjectSettings["logoShape"] } })}
                    >
                      <option value="original">Giữ nguyên như ảnh tải lên</option>
                      <option value="circle">Cắt tròn</option>
                    </select>
                  </Field>
                  <Field label="Kích thước logo">
                    <input type="range" min="0.05" max="0.35" step="0.01" value={project.settings.logoScale} onChange={(e) => change({ ...project, settings: { ...project.settings, logoScale: Number(e.target.value) } })} />
                    <small>{Math.round(project.settings.logoScale * 100)}% chiều rộng video</small>
                  </Field>
                  <Field label="Độ trong suốt">
                    <input type="range" min="0.1" max="1" step="0.05" value={project.settings.logoOpacity} onChange={(e) => change({ ...project, settings: { ...project.settings, logoOpacity: Number(e.target.value) } })} />
                    <small>{Math.round(project.settings.logoOpacity * 100)}%</small>
                  </Field>
                </>
              )}
            </div>
              </>}
              voiceExtra={<>
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
                  : "Giọng đọc tổng hợp từ kịch bản của bạn."}
              </p>
              </>}
              musicExtra={<>
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
              </>}
              subtitleExtra={<>
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
                      type="button"
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
                      Timestamp sẽ được tạo từ audio thật; bạn cũng có thể thêm
                      thủ công.
                    </small>
                  )}
                </div>
              )}
              </>}
            />
          </fieldset>
        </aside>
      </div>
    </div>
  );
}

function MediaPage() {
  const { isDemo } = useAuth();
  const [kind, setKind] = useState<"all" | "image" | "audio" | "video">("all");
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<
    Array<{
      id: string;
      kind: "image" | "audio" | "video";
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
      setError(e instanceof Error ? e.message : "Chưa tải được thư viện media. Hãy tải lại trang.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadMedia(); }, [isDemo]);
  const shown = items.filter((item) => kind === "all" || item.kind === kind);
  return (
    <SimplePage
      title="Thư viện media"
      subtitle="Ảnh, motion video và giọng đọc đã dùng trong các dự án."
    >
      <div className="filter-pills">
        <button
          type="button"
          className={kind === "all" ? "active" : ""}
          onClick={() => setKind("all")}
        >
          Tất cả
        </button>
        <button
          type="button"
          className={kind === "image" ? "active" : ""}
          onClick={() => setKind("image")}
        >
          Ảnh
        </button>
        <button
          type="button"
          className={kind === "audio" ? "active" : ""}
          onClick={() => setKind("audio")}
        >
          Giọng đọc
        </button>
        <button
          type="button"
          className={kind === "video" ? "active" : ""}
          onClick={() => setKind("video")}
        >
          Video
        </button>
      </div>
      {error && <div className="dashboard-feedback"><Notice tone="bad"><span>{error}</span><Button variant="ghost" onClick={() => void loadMedia()}>Thử lại</Button></Notice></div>}
      {loading ? (
        <div className="empty"><LoaderCircle className="spin" /><h2>Đang tải thư viện</h2><p>Đang lấy các ảnh và audio đã lưu của bạn.</p></div>
      ) : shown.length ? (
        <div className="media-grid">
          {shown.map((item) => (
            <article key={item.id}>
              {item.kind === "image" ? (
                <img src={item.url} alt={item.projectTitle} />
              ) : item.kind === "video" ? (
                <video controls preload="metadata" src={item.url} aria-label={item.projectTitle} />
              ) : (
                <div className="audio-tile">
                  <Mic2 />
                  <audio controls src={item.url} />
                </div>
              )}
              <strong>{item.projectTitle}</strong>
              <span>{item.kind === "image" ? "Ảnh cảnh" : item.kind === "video" ? "Motion video" : "Giọng đọc"}</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Image size={42} />
          <h2>Chưa có media</h2>
          <p>Ảnh và giọng đọc bạn tạo hoặc tải lên sẽ nằm ở đây. Tạo video đầu tiên để bắt đầu.</p>
          <Link className="button button-primary" to="/new"><Plus size={17} /> Tạo video mới</Link>
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
      setError(e instanceof Error ? e.message : "Chưa tải được lịch sử xuất video. Hãy tải lại trang.");
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
      setError(e instanceof Error ? e.message : "Chưa tải được file MP4. Hãy thử lại.");
    } finally {
      setBusyExport(null);
    }
  }
  return (
    <SimplePage
      title="Lịch sử xuất video"
      subtitle="Các video đã xuất xong. Tải lại file MP4 bất cứ lúc nào."
    >
      {error && <div className="dashboard-feedback"><Notice tone="bad"><span>{error}</span><Button variant="ghost" onClick={() => void loadExports()}>Thử lại</Button></Notice></div>}
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
          <h2>Chưa có video nào được xuất</h2>
          <p>Video làm xong sẽ hiện ở đây, kèm thời lượng và nút tải MP4.</p>
          <Link className="button button-primary" to="/new"><Plus size={17} /> Tạo video mới</Link>
        </div>
      )}
    </SimplePage>
  );
}

/** Claude first, as in the provider choices of the Studio. */
const PAID_PROVIDERS: KeyProvider[] = ["anthropic", "openai"];

/** One paid provider: paste the owner's own key, see only its last four characters afterwards, replace or remove it. */
function ApiKeyCard({
  provider,
  status,
  enabled,
  demo,
  onSave,
  onRemove,
}: {
  provider: KeyProvider;
  status: ApiKeySummary["keys"][KeyProvider];
  enabled: boolean;
  demo: boolean;
  onSave(key: string): Promise<{ error?: string; note?: string }>;
  onRemove(): Promise<{ error?: string }>;
}) {
  const info = KEY_PROVIDER_INFO[provider];
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputId = `api-key-${provider}`;
  const showForm = !status.saved || replacing;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setNote(null);
    const result = await onSave(value);
    setBusy(false);
    if (result.error) {
      setProblem(result.error);
      return;
    }
    setValue(""); // the key is gone from the page the moment it is saved
    setReplacing(false);
    setNote(result.note ?? "Đã kiểm tra và lưu khóa. Bạn có thể chọn dịch vụ này trong Tùy chọn của Studio.");
  }

  async function remove() {
    if (!(await askConfirm({
      title: `Xóa khóa ${info.name} đã lưu?`,
      detail: "Dự án đang dùng dịch vụ này sẽ cần khóa mới, hoặc chuyển sang tạo trên máy của bạn.",
      confirmLabel: "Xóa khóa",
      tone: "danger",
    }))) return;
    setBusy(true);
    setProblem(null);
    setNote(null);
    const result = await onRemove();
    setBusy(false);
    if (result.error) setProblem(result.error);
    else setNote("Đã xóa khóa. Bạn nên thu hồi khóa này ở trang nhà cung cấp nếu không dùng nữa.");
  }

  return (
    <section className="api-key-card" aria-label={`Khóa API ${info.name}`}>
      <div className="api-key-head">
        <div>
          <strong>{info.name}</strong>
          <span>Dùng để {info.unlocks}</span>
        </div>
        <b className={status.saved ? "configured" : "unknown"}>{status.saved ? `Đã lưu …${status.last4 ?? ""}` : "Chưa có khóa"}</b>
      </div>
      {!enabled && !demo && (
        <Notice tone="warn">Máy chủ chưa bật tính năng lưu khóa API. Hãy báo người quản trị máy.</Notice>
      )}
      {showForm && enabled && (
        <form className="api-key-form" onSubmit={submit}>
          <label htmlFor={inputId}>{status.saved ? "Khóa mới thay cho khóa đã lưu" : "Khóa API của bạn"}</label>
          <div>
            <input
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={`${info.prefix}…`}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
            <button className="button button-secondary" type="submit" disabled={busy || !value.trim()}>
              {busy ? "Đang kiểm tra…" : "Lưu và kiểm tra"}
            </button>
            {replacing && (
              <button className="button button-ghost" type="button" disabled={busy} onClick={() => { setReplacing(false); setValue(""); setProblem(null); }}>
                Hủy
              </button>
            )}
          </div>
        </form>
      )}
      {status.saved && !replacing && (
        <div className="api-key-actions">
          <button className="button button-ghost" type="button" disabled={busy || !enabled} onClick={() => { setReplacing(true); setNote(null); }}>Thay khóa</button>
          <button className="button button-ghost" type="button" disabled={busy} onClick={() => void remove()}>Xóa khóa</button>
        </div>
      )}
      {problem && <Notice tone="bad">{problem}</Notice>}
      {note && !problem && <Notice tone="success">{note}</Notice>}
      <small className="api-key-help">
        Khóa được mã hóa trên máy chủ, chỉ dùng cho tài khoản của bạn và không bao giờ hiện lại. Lấy khóa tại{" "}
        <a href={info.consoleUrl} target="_blank" rel="noopener noreferrer">{info.console}</a>.
      </small>
    </section>
  );
}

function SettingsPage() {
  const { isDemo } = useAuth();
  const defaultServiceStatuses: Record<ServiceId, ServiceStatus> = {
    api: { state: isDemo ? "disabled" : "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
    supabase: { state: isDemo ? "disabled" : "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
    openai: { state: "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
    anthropic: { state: "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
    ollama: { state: "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
    localMedia: { state: "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
    faceDetail: { state: "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
    whiteboard: { state: "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
    worker: { state: "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
    render: { state: "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
  };
  const defaultUsageStats = {
    today: { usedUsd: 0, eventCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    last30Days: { usedUsd: 0, eventCount: 0, totalTokens: 0 },
    budgetUsd: 3,
    remainingUsd: 3,
    budgetPercent: 0,
    tokenSource: "estimated" as const,
  };
  const [settings, setSettings] = useState({
    dailyBudgetUsd: 3,
    maxConcurrentJobs: 1,
    apiKeys: { enabled: true, keys: { openai: { saved: false }, anthropic: { saved: false } } } as ApiKeySummary,
    capabilities: {
      supabase: !isDemo,
      ai: false,
      openai: false,
      anthropic: false,
      ollama: false,
      localMedia: false,
      render: false,
    },
    serviceStatuses: defaultServiceStatuses,
    balancer: (isDemo ? demoSystem().balancer : null) as BalancerSummary | null,
    airSetup: null as AirSetupSummary | null,
    usageStats: defaultUsageStats as UsageStats,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [machineBusy, setMachineBusy] = useState(false);
  const [machineNotice, setMachineNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  /** Reads the account's settings again; the page follows an installation or a running video without a click. */
  async function refreshSettings() {
    if (isDemo) return;
    try {
      const next = await api.getSettings();
      setSettings({ ...next, usageStats: next.usageStats ?? defaultUsageStats });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Chưa đọc được cài đặt. Kiểm tra máy chính đang bật rồi tải lại trang.");
    }
  }

  /** "Đồng bộ ngay": the second machine compares itself with the main one at once; the page follows the result. */
  async function syncNow(id: string) {
    setSyncing(id);
    setMachineNotice(null);
    try {
      await api.syncNow(id);
      setMachineNotice({ tone: "ok", text: `Đã gửi yêu cầu: máy ${id} sẽ đối chiếu với Mac Mini trong vài giây. Trạng thái cập nhật ngay trên trang này.` });
      window.setTimeout(() => void refreshSettings(), 5000);
    } catch (error) {
      setMachineNotice({ tone: "warn", text: error instanceof Error ? error.message : "Không gửi được yêu cầu đồng bộ" });
    } finally {
      setSyncing(null);
    }
  }

  /** Switches a machine off or on, or changes how work is split; the server saves it and the worker follows at once. */
  async function changeMachines(input: { mode?: BalancerSummary["mode"]; disabled?: string[] }) {
    const current = settings.balancer;
    if (!current) return;
    setMachineBusy(true);
    setMachineNotice(null);
    try {
      if (isDemo) {
        setSettings((value) => ({ ...value, balancer: demoBalancerAfter(current, input) }));
        setMachineNotice({ tone: "ok", text: "Chế độ mẫu chỉ minh họa: không đổi máy thật." });
        return;
      }
      const result = await api.setBalancer(input);
      setSettings((value) => ({ ...value, balancer: result.balancer ?? value.balancer }));
      setMachineNotice(result.applied
        ? { tone: "ok", text: "Đã lưu. Áp dụng cho các việc mới ngay bây giờ; việc đang chạy vẫn xong như cũ." }
        : { tone: "warn", text: "Đã lưu. Máy chính sẽ áp dụng trong vài giây." });
      if (!result.applied) window.setTimeout(() => void refreshSettings(), 4000);
    } catch (error) {
      setMachineNotice({ tone: "warn", text: error instanceof Error ? error.message : "Không lưu được lựa chọn máy" });
    } finally {
      setMachineBusy(false);
    }
  }

  useEffect(() => {
    if (isDemo) return;
    void refreshSettings();
  }, [isDemo]);

  // While the Air is being installed, or a machine is making pictures or voices, the page follows it without a click.
  const watching = Boolean(settings.airSetup?.active)
    || Boolean(settings.balancer?.nodes.some((node) => Object.values(node.lanes).some((lane) => lane.running > 0) || node.sync?.state === "syncing"));
  useEffect(() => {
    if (isDemo || !watching) return;
    const timer = window.setInterval(() => void refreshSettings(), 4000);
    return () => window.clearInterval(timer);
  }, [isDemo, watching]);

  async function saveSettings() {
    if (isDemo) {
      setMessage("Chế độ mẫu không lưu hạn mức.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const next = await api.updateSettings({
        dailyBudgetUsd: settings.dailyBudgetUsd,
        maxConcurrentJobs: settings.maxConcurrentJobs,
      });
      setSettings({
        ...next,
        usageStats: next.usageStats ?? {
          ...settings.usageStats,
          budgetUsd: settings.dailyBudgetUsd,
          remainingUsd: Math.max(0, settings.dailyBudgetUsd - settings.usageStats.today.usedUsd),
        },
      });
      setMessage("Đã lưu hạn mức. Áp dụng cho các video tạo từ bây giờ.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Chưa lưu được cài đặt. Hãy thử lại.",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Saves or removes the owner's own key; resolves with a message for the card, or null when all went well. */
  async function saveKey(provider: KeyProvider, key: string): Promise<{ error?: string; note?: string }> {
    const reason = keyFormatError(provider, key);
    if (reason) return { error: reason };
    if (isDemo) {
      // The demo keeps nothing: only the last four characters are shown, for this page view, and the key is dropped at once.
      setSettings((current) => ({ ...current, apiKeys: { ...current.apiKeys, keys: { ...current.apiKeys.keys, [provider]: { saved: true, last4: lastFour(key), savedAt: new Date().toISOString() } } } }));
      return { note: "Chế độ mẫu chỉ minh họa: khóa không được gửi đi hay lưu ở đâu cả." };
    }
    try {
      const next = await api.saveApiKey(provider, key);
      setSettings((current) => ({ ...current, ...next, usageStats: next.usageStats ?? current.usageStats }));
      return next.warning ? { note: next.warning } : {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Không lưu được khóa. Hãy thử lại." };
    }
  }
  async function removeKey(provider: KeyProvider): Promise<{ error?: string }> {
    if (isDemo) {
      setSettings((current) => ({ ...current, apiKeys: { ...current.apiKeys, keys: { ...current.apiKeys.keys, [provider]: { saved: false } } } }));
      return {};
    }
    try {
      const next = await api.removeApiKey(provider);
      setSettings((current) => ({ ...current, ...next, usageStats: next.usageStats ?? current.usageStats }));
      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Không xóa được khóa. Hãy thử lại." };
    }
  }

  return (
    <SimplePage
      title="Cài đặt"
      subtitle="Thiết lập xử lý, dịch vụ tích hợp và giới hạn sử dụng."
    >
      <div className="settings-page-grid">
        <section>
          <div className="section-heading-row">
            <div>
              <h2>Máy tạo video</h2>
              <p className="microcopy">Chọn máy nhận việc mới. Việc đang chạy vẫn tiếp tục.</p>
            </div>
          </div>
          {settings.balancer && settings.balancer.nodes.length ? (
            <MachinesPanel
              balancer={settings.balancer}
              busy={machineBusy}
              notice={machineNotice}
              services={settings.serviceStatuses}
              onChange={(input) => void changeMachines(input)}
              onSyncNow={(id) => void syncNow(id)}
              syncing={syncing}
            />
          ) : (
            <p className="microcopy">
              Hiện chỉ có máy chính nên chưa có gì để bật hoặc tắt. Thêm máy phụ (ví dụ MacBook Air) theo hướng dẫn "Thêm máy phụ" trong <code>docs/TU-HOST.md</code>;
              tình trạng các dịch vụ xem ở <Link to="/system">Hệ thống</Link>.
            </p>
          )}
          {settings.airSetup ? <AirSetupPanel setup={settings.airSetup} /> : null}
          <details className="settings-more" open={PAID_PROVIDERS.some((provider) => settings.apiKeys.keys[provider].saved) || undefined}>
            <summary>
              Dịch vụ trả phí (không bắt buộc)
              <small>
                {PAID_PROVIDERS.map((provider) => `${provider === "anthropic" ? "Claude" : "OpenAI"}: ${settings.apiKeys.keys[provider].saved ? "đã có khóa" : "chưa có khóa"}`).join(" · ")}
              </small>
            </summary>
            <p className="microcopy">
              Muốn viết kịch bản bằng Claude hoặc dùng OpenAI để tạo ảnh, giọng đọc? Dán khóa API của riêng bạn. Chi phí do nhà cung cấp tính thẳng vào tài khoản của bạn; không dùng khóa thì mọi thứ vẫn chạy bằng máy này, miễn phí.
            </p>
            {PAID_PROVIDERS.map((provider) => (
              <ApiKeyCard
                key={provider}
                provider={provider}
                status={settings.apiKeys.keys[provider]}
                enabled={settings.apiKeys.enabled}
                demo={isDemo}
                onSave={(key) => saveKey(provider, key)}
                onRemove={() => removeKey(provider)}
              />
            ))}
          </details>
        </section>
        <section>
          <div className="section-heading-row"><div><h2>Hiệu suất và chi phí</h2><p className="microcopy">Giới hạn số video chạy cùng lúc và ngân sách dịch vụ trả phí. Tạo trên máy của bạn không tốn phí.</p></div></div>
          <Field
            label="Số video tạo cùng lúc"
            hint="Mac Mini xử lý nhanh nhất khi tạo một video một lúc; video sau tự xếp hàng."
          >
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
          <details className="settings-more">
            <summary>
              Ngân sách cho dịch vụ trả phí
              <small>Hôm nay đã dùng {formatUsd(settings.usageStats.today.usedUsd)} / {formatUsd(settings.usageStats.budgetUsd)}</small>
            </summary>
            <div className="budget-meter" aria-label={`Đã dùng ${settings.usageStats.budgetPercent}% ngân sách`}>
              <span style={{ width: `${settings.usageStats.budgetPercent}%` }} />
            </div>
            <div className="usage-metrics">
              <div><span>Đã dùng</span><strong>{formatUsd(settings.usageStats.today.usedUsd)}</strong></div>
              <div><span>Còn lại</span><strong>{formatUsd(settings.usageStats.remainingUsd)}</strong></div>
              <div><span>Token ước tính</span><strong>{settings.usageStats.today.totalTokens.toLocaleString("vi-VN")}</strong></div>
              <div><span>Lượt dùng</span><strong>{settings.usageStats.today.eventCount}</strong></div>
            </div>
            <Field label="Ngân sách mỗi ngày (USD)" hint={`30 ngày qua: ${formatUsd(settings.usageStats.last30Days.usedUsd)}. Tạo trên máy của bạn không tính phí.`}>
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
          </details>
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

function WhiteboardPage() {
  const editorSrc = `${import.meta.env.BASE_URL}whiteboard-editor.html`;
  const navigate = useNavigate();
  return (
    <div className="page whiteboard-page">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Quay lại
      </button>
      <div className="page-heading">
        <div>
          <h1>Chia vùng vẽ (nâng cao)</h1>
          <p>
            Chọn phong cách <strong>Vẽ tay bảng trắng</strong> là đủ: studio tự vẽ toàn cảnh, nét viền trước rồi tô màu.
            Trang này chỉ dùng khi bạn muốn quyết định vùng nào được vẽ trước và trong bao lâu.
          </p>
        </div>
        <div className="whiteboard-how" role="note" aria-label="Các bước">
          <span>① Tải ảnh cảnh về máy (menu ⋯ của cảnh)</span>
          <span className="whiteboard-how-arrow" aria-hidden="true">→</span>
          <span>② Chia vùng và lưu JSON ở đây</span>
          <span className="whiteboard-how-arrow" aria-hidden="true">→</span>
          <span>③ "Tải file vùng vẽ" vào cảnh, bấm Tạo video</span>
        </div>
      </div>
      <iframe
        src={editorSrc}
        title="Trình chia vùng vẽ cho video vẽ tay"
        className="whiteboard-iframe"
        allow="clipboard-read; clipboard-write"
      />
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
      <Suspense fallback={<div className="center-page">Đang tải giao diện…</div>}>
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
              <Route path="dub-subtitle" element={<DubSubtitlePage />} />
              <Route path="tts" element={<TextToSpeechPage />} />
              <Route path="media" element={<MediaPage />} />
              <Route path="exports" element={<ExportsPage />} />
              <Route path="whiteboard" element={<WhiteboardPage />} />
              <Route path="system" element={<SystemPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Protected>
        }
      />
        </Routes>
      </Suspense>
      <ConfirmHost />
    </AppErrorBoundary>
  );
}
