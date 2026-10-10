const OAUTH_ERROR_KEYS = [
  "error_description",
  "error_code",
  "error",
] as const;

export function authErrorMessage(message: string | undefined | null) {
  if (!message) return null;
  const normalized = decodeURIComponent(message.replace(/\+/g, " "));
  if (/invalid login credentials/i.test(normalized))
    return "Email hoặc mật khẩu không đúng.";
  if (/email not confirmed/i.test(normalized))
    return "Email chưa được xác nhận. Hãy mở email xác nhận trước khi đăng nhập.";
  if (/rate limit|too many requests/i.test(normalized))
    return "Có quá nhiều lần thử. Vui lòng chờ một lát rồi thử lại.";
  if (/provider.*(not enabled|disabled)|not enabled.*provider|unsupported provider/i.test(normalized))
    return "Đăng nhập Google chưa được bật trên Supabase. Hãy bật Google trong Authentication → Providers.";
  if (/redirect.*(not allowed|invalid)|invalid redirect|redirect_uri_not_allowed/i.test(normalized))
    return "Địa chỉ quay lại sau đăng nhập chưa được cho phép trên Supabase. Hãy thêm URL GitHub Pages vào Redirect URLs.";
  if (/access_denied|access denied|cancelled|canceled/i.test(normalized))
    return "Bạn đã hủy đăng nhập Google.";
  return normalized;
}

export function authRedirectUrl(
  origin: string,
  baseUrl: string | undefined,
  path = "",
) {
  const base = new URL(baseUrl || "/", origin);
  if (!path) return base.toString();
  return new URL(path.replace(/^\/+/, ""), base).toString();
}

export function readAuthCallbackError(search: string, hash: string) {
  const paramsList = [
    new URLSearchParams(search),
    new URLSearchParams(hash.replace(/^#/, "")),
  ];
  for (const params of paramsList) {
    const value = OAUTH_ERROR_KEYS.map((key) => params.get(key)).find(Boolean);
    const message = authErrorMessage(value);
    if (message) return message;
  }
  return null;
}

export function clearAuthCallbackParams(href: string) {
  const url = new URL(href);
  [
    "code",
    "error",
    "error_code",
    "error_description",
    "provider",
  ].forEach((key) => url.searchParams.delete(key));
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  [
    "access_token",
    "expires_at",
    "expires_in",
    "refresh_token",
    "token_type",
    "type",
    "error",
    "error_code",
    "error_description",
  ].forEach((key) => hashParams.delete(key));
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : "";
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * What /reset-password shows. The emailed link signs the person in asynchronously, so the page must wait for the
 * session check to finish: it used to bounce a not-yet-signed-in visitor to /login at once, the session then arrived,
 * the login page sent the signed-in person to the dashboard, and the new-password form never appeared.
 */
export function resetPasswordView(state: { loading: boolean; user: unknown; isDemo: boolean }): "wait" | "login" | "form" {
  if (state.isDemo) return "login";
  if (state.loading) return "wait";
  return state.user ? "form" : "login";
}
