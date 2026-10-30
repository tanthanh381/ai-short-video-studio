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
import { Badge, Button, Field, Notice } from "./components/ui";
import { askConfirm, ConfirmHost } from "./components/ConfirmDialog";
import { DEMO_ONLY, DEMO_VOICE } from "./lib/copy";

const navItems = [
  { to: "/", label: "Tổng quan", icon: Gauge },
  { to: "/dub-subtitle", label: "Lồng tiếng & phụ đề", icon: Subtitles },
  { to: "/tts", label: "Đọc văn bản (TTS)", icon: Mic2 },
  { to: "/exports", label: "Lịch sử xuất", icon: Film },
  { to: "/system", label: "Hệ thống", icon: Activity },
  { to: "/settings", label: "Cài đặt", icon: Settings },
];

const APP_NAME = "Studio Giọng Việt";

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
            <strong>Giọng Việt</strong>
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
          <span>Studio Giọng Việt</span>
        </header>
        {isDemo && (
          <div className="demo-bar">
            <strong>Đang xem chế độ mẫu.</strong> Bạn có thể xem giao diện;
            lồng tiếng và tạo giọng đọc cần máy chính đang bật.
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
            Biến lời thoại
            <br />
            thành giọng đọc tiếng Việt.
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
              <strong>Giọng Việt</strong>
              <span>Studio</span>
            </div>
          </div>
          <h1>{resetMode ? "Đặt lại mật khẩu" : "Đăng nhập vào studio"}</h1>
          <p>
            {resetMode
              ? "Nhập email được cấp quyền để nhận liên kết đặt mật khẩu."
              : "Không gian riêng để lồng tiếng và đọc văn bản tiếng Việt."}
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
            <div><strong>Giọng Việt</strong><span>Studio</span></div>
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

function HubPage() {
  return (
    <SimplePage title="Xưởng giọng nói tiếng Việt" subtitle="Chọn công cụ bạn cần. Mọi thứ chạy trên máy của bạn, không tốn phí.">
      <div className="hub-grid">
        <Link to="/dub-subtitle" className="hub-card">
          <span className="hub-card-icon"><Subtitles size={28} /></span>
          <strong>Lồng tiếng & phụ đề</strong>
          <span>Tải video có sẵn, nhập lời thoại, nhận bản dựng có giọng đọc tiếng Việt và phụ đề.</span>
        </Link>
        <Link to="/tts" className="hub-card">
          <span className="hub-card-icon"><Mic2 size={28} /></span>
          <strong>Đọc văn bản (TTS)</strong>
          <span>Dán văn bản, chọn giọng đọc rồi tải file MP3.</span>
        </Link>
      </div>
    </SimplePage>
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

type DubSegment = { id: string; startTimeMs: number; text: string };

function DubSubtitlePage() {
  const { isDemo } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<DubSegment[]>([]);
  const [bulkText, setBulkText] = useState<string | null>(null);
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
  const [currentSubtitleIdx, setCurrentSubtitleIdx] = useState<number | null>(null);
  const [voicePreviewState, setVoicePreviewState] = useState<"idle" | "loading" | "playing">("idle");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [voicePreviewError, setVoicePreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderStage, setRenderStage] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
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

  useEffect(() => {
    if (!playing || !videoRef.current) return;
    const interval = setInterval(() => {
      const currentTimeMs = (videoRef.current?.currentTime ?? 0) * 1000;
      const activeIdx = segments.findIndex((seg, idx) => {
        const nextSeg = segments[idx + 1];
        return seg.startTimeMs <= currentTimeMs && (!nextSeg || nextSeg.startTimeMs > currentTimeMs);
      });
      setCurrentSubtitleIdx(activeIdx >= 0 ? activeIdx : null);
    }, 100);
    return () => clearInterval(interval);
  }, [playing, segments]);

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
    if (segments.length === 0 || !segments.some((s) => s.text.trim())) { setError("Hãy nhập lời thoại để tạo giọng đọc và phụ đề."); return; }
    if (isDemo) { setError(DEMO_VOICE); return; }
    setBusy(true); setError(null); setResultUrl(null); setRenderProgress(0);
    setRenderStage("Đang tải video lên…");
    try {
      const settings = {
        ...DEFAULT_PROJECT_SETTINGS,
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
      const sourceText = segments.map((s) => s.text).join(" ");
      const project = await api.createProject({
        title: file.name.replace(/\.[^.]+$/u, "") || "Video lồng tiếng",
        sourceText,
        inputMode: "full-script",
        settings,
      });
      const sourceVideoPath = await api.uploadMedia(project.id, file, "video");
      setRenderStage("Đang tạo giọng đọc và ghép phụ đề…");
      await api.queue(project.id, "dub_video", { sourceVideoPath, segments, voice, engine, subtitle: settings.subtitle });
      const deadline = Date.now() + 20 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const jobs = await api.getJobs(project.id);
        const dub = jobs.find((job) => job.type === "dub_video");
        if (!dub) continue;
        if (dub.stage) setRenderStage(dub.stage);
        setRenderProgress(dub.progress);
        if (dub.status === "failed") throw new Error(dub.errorMessage || "Lồng tiếng thất bại");
        if (dub.status === "cancelled") throw new Error("Tác vụ đã bị hủy");
        if (dub.status === "completed") break;
      }
      const result = await api.getResult(project.id);
      if (!result?.url) throw new Error("Chưa lấy được video kết quả. Kiểm tra trang Lịch sử xuất.");
      setResultUrl(result.url);
      setRenderStage(null);
    } catch (e) {
      setRenderStage(null);
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
    if (isDemo) {
      setVoicePreviewError(DEMO_VOICE);
      return;
    }
    // Preset voices play a fixed sample clip instantly — no text needed.
    // Non-preset voices require text to generate speech.
    const allText = segments.map((s) => s.text).join(" ");
    if (!isVoicePreset(voice) && !allText.trim()) {
      setVoicePreviewError("Nhập lời thoại trước khi nghe thử.");
      return;
    }
    setVoicePreviewError(null);
    setVoicePreviewState("loading");
    try {
      let url: string;
      if (isVoicePreset(voice)) {
        url = `${import.meta.env.BASE_URL}voice-samples/${voice}.mp3`;
      } else {
        const blob = await api.textToSpeech(allText, voice, engine, 1);
        url = URL.createObjectURL(blob);
      }
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
              {subtitleEnabled && currentSubtitleIdx !== null && segments[currentSubtitleIdx]?.text.trim() && <div
                className={`dub-subtitle-overlay dub-subtitle-${subtitlePosition} dub-subtitle-${subtitlePreset}`}
                style={{ color: subtitleColor, backgroundColor: subtitleBackgroundColor, fontSize: `${subtitleFontSize}px`, textShadow: subtitleShadow }}
              >{segments[currentSubtitleIdx].text.trim()}</div>}
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
          <div className="field">
            <span className="field-label">Lời thoại lồng tiếng (theo khoảng thời gian)</span>
            <span className="field-hint">Thêm từng đoạn lời thoại với thời gian bắt đầu. Để trống thời gian để bắt đầu từ 0:00.</span>
            <div className="dub-segments-list">
              {segments.length === 0 && (
                <div className="dub-segments-empty">
                  <p>Chưa có đoạn lời thoại nào. Bấm nút dưới để thêm.</p>
                </div>
              )}
              {segments.map((segment, idx) => {
                const mins = Math.floor(segment.startTimeMs / 60000);
                const secs = Math.floor((segment.startTimeMs % 60000) / 1000);
                const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;
                return (
                  <div key={segment.id} className="dub-segment-item">
                    <input
                      type="text"
                      placeholder="0:00"
                      value={timeStr}
                      onChange={(e) => {
                        const parts = e.target.value.split(":").filter(Boolean);
                        let ms = 0;
                        if (parts.length === 2) {
                          const [m, s] = parts.map(Number);
                          ms = ((m || 0) * 60000) + ((s || 0) * 1000);
                        } else if (parts.length === 1) {
                          ms = (Number(parts[0]) || 0) * 1000;
                        }
                        setSegments((prev) => prev.map((seg) => seg.id === segment.id ? { ...seg, startTimeMs: ms } : seg));
                      }}
                      className="dub-segment-time"
                      aria-label="Thời gian bắt đầu (MM:SS hoặc giây)"
                    />
                    <textarea
                      value={segment.text}
                      onChange={(e) => setSegments((prev) => prev.map((seg) => seg.id === segment.id ? { ...seg, text: e.target.value } : seg))}
                      placeholder="Nhập lời thoại tiếng Việt…"
                      className="dub-segment-text"
                      rows={3}
                      maxLength={2000}
                    />
                    <button
                      type="button"
                      className="dub-segment-delete"
                      onClick={() => setSegments((prev) => prev.filter((seg) => seg.id !== segment.id))}
                      aria-label="Xóa đoạn này"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="dub-segments-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const newId = crypto.randomUUID?.() || Date.now().toString();
                  setSegments((prev) => [...prev, { id: newId, startTimeMs: 0, text: "" }]);
                }}
              >
                <Plus size={16} /> Thêm đoạn lời thoại
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBulkText(bulkText === null ? "" : null)}
              >
                <FileText size={16} /> Nhập từ văn bản
              </Button>
            </div>
            {bulkText !== null && (
              <div className="dub-bulk-import">
                <p className="dub-bulk-hint">Mỗi dòng: <code>0:05 "lời thoại"</code> hoặc <code>* 0:05 lời thoại</code></p>
                <textarea
                  className="dub-bulk-textarea"
                  rows={8}
                  placeholder={"* 0:00 \"Sự trả thù tốt nhất là không trả thù.\"\n* 0:05 \"Có người nói sai về bạn...\"\n* 0:10 \"Bạn đau, muốn đáp trả ngay...\""}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
                <Button
                  type="button"
                  onClick={() => {
                    const parsed: DubSegment[] = [];
                    for (const line of bulkText.split("\n")) {
                      const mms = line.match(/^\*?\s*(\d+):(\d+)\s+"?(.+?)"?\s*$/);
                      const ms = !mms ? line.match(/^\*?\s*(\d+)\s+"?(.+?)"?\s*$/) : null;
                      let startTimeMs: number;
                      let text: string;
                      if (mms?.[1] != null && mms[2] != null && mms[3] != null) {
                        startTimeMs = (parseInt(mms[1], 10) * 60 + parseInt(mms[2], 10)) * 1000;
                        text = mms[3].trim();
                      } else if (ms?.[1] != null && ms[2] != null) {
                        startTimeMs = parseInt(ms[1], 10) * 1000;
                        text = ms[2].trim();
                      } else { continue; }
                      if (text) parsed.push({ id: crypto.randomUUID?.() || Date.now().toString() + parsed.length, startTimeMs, text });
                    }
                    if (parsed.length > 0) {
                      setSegments((prev) => [...prev, ...parsed]);
                      setBulkText(null);
                    }
                  }}
                >
                  Thêm {bulkText.split("\n").filter((l) => /^\*?\s*\d/.test(l)).length} đoạn
                </Button>
              </div>
            )}
          </div>
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
          {renderStage && (
            <div className="dub-progress" role="status">
              <div className="dub-progress-row"><LoaderCircle className="spin" size={16} /> <span>{renderStage}</span></div>
              <div className="dub-progress-bar"><span style={{ width: `${Math.max(5, renderProgress)}%` }} /></div>
            </div>
          )}
          {resultUrl && (
            <div className="dub-result">
              <div><strong>Video đã lồng tiếng xong</strong><span>Xem lại hoặc tải về</span></div>
              <video controls src={resultUrl} />
              <a className="button button-secondary" href={resultUrl} download><Download size={17} /> Tải video</a>
            </div>
          )}
        </section>
      </div>
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
          <h2>Chưa có bản dựng nào được xuất</h2>
          <p>Video lồng tiếng làm xong sẽ hiện ở đây, kèm thời lượng và nút tải MP4.</p>
          <Link className="button button-primary" to="/dub-subtitle"><Plus size={17} /> Lồng tiếng video mới</Link>
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
    localMedia: { state: "unknown", detail: "Chưa kiểm tra", checkedAt: "" },
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
              <h2>Máy xử lý</h2>
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
              Ứng dụng chạy trên một máy chính (Mac Mini), tự lo lồng tiếng và giọng đọc — không cần máy phụ.
              Tình trạng các dịch vụ xem ở <Link to="/system">Hệ thống</Link>.
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
          <div className="section-heading-row"><div><h2>Hiệu suất và chi phí</h2><p className="microcopy">Giới hạn số bản lồng tiếng chạy cùng lúc và ngân sách dịch vụ trả phí. Tạo trên máy của bạn không tốn phí.</p></div></div>
          <Field
            label="Số bản lồng tiếng cùng lúc"
            hint="Mac Mini xử lý nhanh nhất khi làm một bản một lúc; bản sau tự xếp hàng."
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
              <Route index element={<HubPage />} />
              <Route path="dub-subtitle" element={<DubSubtitlePage />} />
              <Route path="tts" element={<TextToSpeechPage />} />
              <Route path="exports" element={<ExportsPage />} />
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
