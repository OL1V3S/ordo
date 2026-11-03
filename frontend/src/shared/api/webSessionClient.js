// Same-origin client for the web-session endpoints (#292). Requests use relative
// URLs (Vercel rewrite in production, Vite proxy in dev) so the HttpOnly session
// cookie is first-party. No timeout or abort: a refresh whose response is lost
// after the server rotated the credential would end the session.
import { reportServerError } from "./requestReference";

const BASE_PATH = "/api/auth/web-session";

async function readBody(response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";
  if ((response.headers.get("content-type") || "").includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

async function post(path, body, { reportServerError: report = false } = {}) {
  const headers = { "X-Ordo-Web-Session": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_PATH}${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readBody(response);

  if (!response.ok) {
    // Same shape as an axios error, so existing login error mapping applies.
    const error = new Error(`Request failed with status code ${response.status}`);
    error.response = { status: response.status, data };
    // Sign-in only: a failed refresh retries silently every minute and must not raise a notice.
    if (report) reportServerError({ status: response.status, data, headers: response.headers });
    throw error;
  }

  return { status: response.status, data };
}

export const webSessionClient = {
  signIn: ({ email, password }) => post("", { email, password }, { reportServerError: true }),
  refresh: () => post("/refresh"),
  signOut: () => post("/sign-out"),
};
