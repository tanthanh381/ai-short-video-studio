Warning: truncated output (original token count: 56759)
Total output lines: 4679

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
  ListVideo,
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
  Scale,
  Sparkles,
  TrendingUp,
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
  evaluateContentQuality,
  contentQualityRecommendations,
  applyDirectContentRecommendation,
  evaluatePublishReadiness,
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
  TREND_NICHES,
  type TrendDigest,
  type TrendIdea,
} from "@studio/shared";
import { useAuth } from "./state/AuthContext";
const AirSetupPanel = lazy(() => import("./AirSetupPanel").then((module) => ({ default: module.AirSetupPanel })));
const MachinesPanel = lazy(() => import("./MachinesPanel").then((module) => ({ default: module.MachinesPanel })));
const SystemPage = lazy(() => import("./SystemPage").then((module) => ({ default: module.SystemPage })));
import { demoBalancerAfter, demoSystem } from "./lib/demo-system";
import { api, type ServiceId, type ServiceState, type ServiceStatus, type UsageStats, type VideoResult } from "./lib/api";
import { appConfig } from "./lib/config";
import { resetPasswordView } from "./lib/auth";
import { withLayoutTemplate, withVisualPreset } from "./lib/visual-preset";
import { ProjectSaver, type SaveState } from "./lib/project-saver";
import { Badge, Button, Field, Notice } from "./components/ui";
import { askConfirm, ConfirmHost } from "./components/ConfirmDialog";
import { WIZARD_STEPS, stepIndex, detectInputMode, modelGroups, modelSummary, autoModelPatch, modelsReady, HEALTH_LABEL, HEALTH_TONE, type WizardStepId } from "./lib/wizard";
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
import { BATCH_MAX_ITEMS, parseBatchIdeas } from "./lib/batch";
import { applyChannelKit, readChannelKit, saveChannelKit } from "./lib/channel-kit";
import { previewImageForSettings } from "./lib/preview";

const CHANNEL_PRESET_VISUALS: Record<string, { tone: string; badge: string }> = {
  "dao-ly-co-phong": { tone: "paper", badge: "Paper" },
  "ve-tay": { tone: "whiteboard", badge: "Sketch" },
  "video-anh-dong-ai": { tone: "default", badge: "Motion AI" },
  "quy-tac-co-nhan": { tone: "sepia", badge: "Wisdom" },
};

function channelPresetVisual(id: string) {
  return CHANNEL_PRESET_VISUALS[id] ?? { tone: "default", badge: "Video" };
}

function PresetPreviewArt({ id }: { id: string }) {
  const visual = channelPresetVisual(id);
  // Use the same preset settings as the actual creation flow. Keeping a second
  // id -> image table here made template cards drift away from the renderer
  // whenever a preset's visual/layout was changed.
  const preset = CHANNEL_PRESETS.find((item) => item.id === id);
  const file = previewImageForSettings(preset?.apply(DEFAULT_PROJECT_SETTINGS) ?? DEFAULT_PROJECT_SETTINGS);
  return (
    <span className={`channel-preset-art ${visual.tone}`} aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}preset-previews/${file}`} alt="" loading="lazy" decoding="async" />
      <span className="channel-preset-art-badge">{visual.badge}</span>
    </span>
  );
}

const navItems = [
  { to: "/", label: "Tổng quan", icon: Gauge },
  { to: "/new", label: "Tạo video mới", icon: Plus },
  { to: "/trends", label: "Ý tưởng xu hướng", icon: TrendingUp },
  { to: "/batch", label: "Tạo hàng loạt", icon: ListVideo },
  { to: "/dub-subtitle", label: "Lồng tiếng & phụ đề", icon: Subtitles },
  { to: "/tts", label: "Đọc văn bản (TTS)", icon: Mic2 },
  { to: "/media", label: "Thư viện media", icon: Library },
  { to: "/exports", label: "Lịch sử xuất", icon: Film },
  { to: "/rights", label: "Quyền sử dụng", icon: Scale },
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
        // Preset voices ship a pre-generated clip in public/voice-samples, so "nghe thử" plays instantly
        // without waking the local TTS node. Non-preset voices (OpenAI, a cloned voice) fall back to
        // on-demand synthesis.
        url = isVoicePreset(voice)
          ? `${import.meta.env.BASE_URL}voice-samples/${voice}.mp3`
          : URL.createObjectURL(await api.voicePreview(voice, engine));
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
        {state === "playing" ? <><Pause size={16} /> Dừng</> : <><Play size={16} /> {state === "loading" ? "Đang tải…" : "Nghe thử giọng"}</>}
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
          <label className="field tts-speed-f…36759 tokens truncated…                     // on a phone the preview is a tab of its own: show it, the logo is dragged there
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

function TrendsPage() {
  const navigate = useNavigate();
  const { isDemo } = useAuth();
  const [digest, setDigest] = useState<TrendDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.getTrends().then((r) => { if (active) setDigest(r.digest); }).catch(() => undefined).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function refresh() {
    if (isDemo) { setError(DEMO_ONLY); return; }
    setRefreshing(true); setError(null);
    try {
      const { digest: next } = await api.refreshTrends();
      setDigest(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa tạo được ý tưởng xu hướng. Hãy thử lại.");
    } finally { setRefreshing(false); }
  }

  /** Open the video wizard pre-filled from an idea: its niche picks the template, its hook + outline seed the content. */
  function createFromIdea(idea: TrendIdea) {
    const preset = CHANNEL_PRESETS.find((p) => p.id === idea.niche);
    const base: ProjectSettings = { ...DEFAULT_PROJECT_SETTINGS, textProvider: "anthropic", mediaProvider: "local", voice: DEFAULT_VOICE_PRESET, autoMusic: true, captionHighlight: true, hookTitle: true };
    const settings = preset ? preset.apply({ ...base, showKeyPoints: false }) : base;
    const sourceText = [idea.hook, ...idea.scriptOutline].filter(Boolean).join("\n");
    const state = { step: "template", sourceText, inputMode: "idea", modeChosen: true, templateId: preset ? preset.id : null, customized: false, settings, project: null };
    try { sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    navigate("/new");
  }

  const nicheLabel = (id: string) => TREND_NICHES.find((n) => n.id === id)?.label ?? "Chủ đề";
  return (
    <div className="page trends-page">
      <div className="page-heading">
        <div>
          <h1>Ý tưởng xu hướng</h1>
          <p>Mỗi 7h sáng, Claude nghiên cứu xu hướng trên web rồi gợi ý ý tưởng và kịch bản video bám theo chủ đề kênh của bạn.</p>
        </div>
        <Button variant="secondary" busy={refreshing} disabled={isDemo} onClick={() => void refresh()}>
          <RefreshCw size={16} /> {refreshing ? "Đang nghiên cứu xu hướng…" : "Làm mới hôm nay"}
        </Button>
      </div>

      <Notice tone="info">Đây là ý tưởng do AI nghiên cứu để <strong>bám xu hướng</strong> — tham khảo, không đảm bảo chắc chắn viral. Danh sách tự cập nhật mỗi sáng; bấm “Làm mới” để tạo lại ngay.</Notice>
      {error && <Notice tone="bad">{error}</Notice>}

      {loading ? (
        <div className="center-page"><LoaderCircle className="spin" /> Đang tải ý tưởng…</div>
      ) : !digest || digest.ideas.length === 0 ? (
        <div className="empty">
          <TrendingUp size={42} />
          <h2>Chưa có ý tưởng cho hôm nay</h2>
          <p>Bấm “Làm mới hôm nay” để Claude nghiên cứu xu hướng và gợi ý ngay, hoặc chờ bản tự động lúc 7h sáng.</p>
          {!isDemo && <Button onClick={() => void refresh()} busy={refreshing}><RefreshCw size={17} /> Làm mới hôm nay</Button>}
          {isDemo && <Notice tone="warn">{DEMO_ONLY}</Notice>}
        </div>
      ) : (
        <>
          <p className="trends-meta">
            Cập nhật {new Date(digest.generatedAt).toLocaleString("vi-VN")} · {digest.ideas.length} ý tưởng
            {digest.usedWebSearch ? " · có tìm kiếm web" : " · chưa tìm web (dùng kiến thức AI)"}
          </p>
          <div className="trend-list">
            {digest.ideas.map((idea, index) => (
              <article key={index} className="trend-card">
                <div className="trend-card-top">
                  <Badge tone="info">{nicheLabel(idea.niche)}</Badge>
                  <span className="trend-card-meta">{idea.platform} · {idea.durationSec}s</span>
                </div>
                <h2>{idea.title}</h2>
                <p className="trend-hook">“{idea.hook}”</p>
                {idea.whyTrending && <p className="trend-why"><strong>Vì sao bám xu hướng:</strong> {idea.whyTrending}</p>}
                {idea.scriptOutline.length > 0 && (
                  <details className="trend-outline">
                    <summary>Dàn ý kịch bản</summary>
                    <ol>{idea.scriptOutline.map((step, i) => <li key={i}>{step}</li>)}</ol>
                  </details>
                )}
                {idea.hashtags.length > 0 && <p className="trend-tags">{idea.hashtags.join(" ")}</p>}
                <Button variant="secondary" onClick={() => createFromIdea(idea)}><Clapperboard size={16} /> Tạo video từ ý tưởng này</Button>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
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
              <Route path="new" element={<WizardPage />} />
              <Route path="batch" element={<BatchPage />} />
              <Route path="trends" element={<TrendsPage />} />
              <Route path="studio/:id" element={<StudioPage />} />
              <Route path="dub-subtitle" element={<DubSubtitlePage />} />
              <Route path="tts" element={<TextToSpeechPage />} />
              <Route path="media" element={<MediaPage />} />
              <Route path="exports" element={<ExportsPage />} />
              <Route path="rights" element={<UsageRightsPage />} />
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
