// Web-session orchestration (#292, #337): sign-in, refresh and sign-out against
// the same-origin web-session endpoints. The long-lived credential stays in an
// HttpOnly cookie. The 2-hour access token is held in this tab's memory only
// (never in storage), so every page load refreshes through the cookie, serialized
// across tabs by a Web Lock. Only the non-secret identity is stored. Never log
// tokens.
import { webSessionClient } from "../api/webSessionClient";
import {
  adoptAccessToken,
  clearSession,
  establishSession,
  getAccessToken,
  getSessionSnapshot,
  getStoredSessionId,
  hasStoredIdentity,
  removeLegacyAccessToken,
  replaceAccessToken,
  subscribeToSession,
  syncSessionFromStorage,
} from "./session";

export const REFRESH_LOCK_NAME = "ordo-web-session-refresh";
export const SESSION_CHANNEL_NAME = "ordo-session";
export const PENDING_SIGN_OUT_KEY = "pending-sign-out";
export const REFRESH_LEAD_MS = 5 * 60 * 1000;
// Inside the lock, a token with more than this left needs no scheduled refresh.
const FRESH_ENOUGH_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;
// A scheduled refresh never fires sooner than this, and a tab never starts a
// non-401 refresh within this long of its last success. Guards against a device
// clock running ahead, where a fresh token looks nearly expired.
export const MIN_REFRESH_INTERVAL_MS = 60 * 1000;
// After this long with no answer the loading view adds a "taking longer" line.
// With no stored identity it also gives way to sign-in (a late refresh still signs in).
const BOOT_WAIT_MS = 4000;
// Boot retries after a network error or 5xx while an identity is stored.
const BOOT_RETRY_BASE_MS = 5000;
const BOOT_RETRY_MAX_MS = 30 * 1000;
const MAX_IMMEDIATE_RETRIES = 3;

let inFlight = null;
let timer = null;
let channel = null;
let started = false;
let bootPromise = null;
let restoring = null;
let lastRefreshAt = 0;
// Why the last refresh gave no token: "network" (error, 5xx, bad body, retry),
// "ended" (the server or cookie said the session is over) or "superseded"
// (another tab changed the sign-in meanwhile, so the result was discarded).
let lastFailure = null;
const bootListeners = new Set();
let bootStatus = Object.freeze({ pending: false, slow: false, unreachable: false });

// JWT `exp` in milliseconds, used for scheduling only; null when unreadable.
export function tokenExpiry(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const exp = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function timeLeft(token) {
  const exp = token ? tokenExpiry(token) : null;
  return exp === null ? -1 : exp - Date.now();
}

function isSignOutPending() {
  try {
    return localStorage.getItem(PENDING_SIGN_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

function setSignOutPending(pending) {
  try {
    if (pending) localStorage.setItem(PENDING_SIGN_OUT_KEY, "1");
    else localStorage.removeItem(PENDING_SIGN_OUT_KEY);
  } catch {
    // Storage unavailable: nothing durable to record.
  }
}

// One web-session request at a time across tabs. Without Web Locks the request
// runs unlocked; a resulting false reuse fails closed to sign-in.
function withLock(task) {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks?.request ? locks.request(REFRESH_LOCK_NAME, task) : task();
}

function broadcastSignedOut() {
  try {
    const sender = channel ?? (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION_CHANNEL_NAME));
    sender?.postMessage({ type: "signed-out" });
    if (sender && sender !== channel) sender.close();
  } catch {
    // The storage event still signs out other tabs.
  }
}

function sameSignIn(before) {
  return getSessionSnapshot().id === before.id;
}

// A failure that may pass: no response, a server error, or a request to retry.
function isTransient(error) {
  const status = error?.response?.status;
  return status === undefined || status >= 500 || status === 408 || status === 429;
}

async function runRefresh(triggerToken, reason) {
  lastFailure = null;
  if (isSignOutPending()) return false;

  // Re-read inside the lock: this tab's own token may already have been replaced.
  // Tokens are per tab, so another tab's refresh never satisfies this one.
  const held = getAccessToken();
  if (held && held !== triggerToken) return true;
  if (held && reason !== "unauthorized" && timeLeft(held) > FRESH_ENOUGH_MS) return true;

  if (held && reason !== "unauthorized" && Date.now() - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return true;

  const before = getSessionSnapshot();
  // The identity in storage when this attempt started (null when none).
  const storedBefore = getStoredSessionId();
  const unchanged = () => sameSignIn(before) && getStoredSessionId() === storedBefore;
  let response;
  try {
    response = await webSessionClient.refresh();
  } catch (error) {
    if (!unchanged()) {
      lastFailure = "superseded";
      return false;
    }
    if (error?.response?.status === 401) {
      // The session ended: sign out everywhere.
      lastFailure = "ended";
      if (before.signedIn || storedBefore) {
        clearSession();
        broadcastSignedOut();
      }
    } else if (before.signedIn && timeLeft(getAccessToken()) <= 0) {
      // Fail closed: a network error or 5xx never keeps an expired token.
      lastFailure = "network";
      clearSession();
    } else if (!before.signedIn && storedBefore && !isTransient(error)) {
      // Boot with a stored identity and a refusal that retrying cannot fix.
      lastFailure = "ended";
      clearSession();
    } else {
      lastFailure = "network";
    }
    return false;
  }

  const { token, email } = response.data ?? {};
  if (isSignOutPending() || !unchanged()) {
    lastFailure = "superseded";
    return false;
  }
  if (typeof token !== "string" || !token) {
    lastFailure = "network";
    return false;
  }

  lastRefreshAt = Date.now();
  if (before.signedIn) replaceAccessToken(token, email);
  else adoptAccessToken(token, email);
  return true;
}

// Single in-flight refresh per tab, serialized across tabs by a Web Lock.
// Resolves true when a usable access token is stored afterwards.
export function refreshWebSession({ triggerToken = getAccessToken(), reason = "scheduled" } = {}) {
  if (isSignOutPending()) return Promise.resolve(false);

  inFlight ??= Promise.resolve()
    .then(() => withLock(() => runRefresh(triggerToken, reason)))
    .catch(() => false)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  if (isSignOutPending()) return;

  const token = getAccessToken();
  if (!token) return;

  const delay = Math.max(MIN_REFRESH_INTERVAL_MS, timeLeft(token) - REFRESH_LEAD_MS);
  timer = setTimeout(async () => {
    timer = null;
    const refreshed = await refreshWebSession({ triggerToken: token });
    // Transient failure while the token is still valid: try again later.
    if (!refreshed && !timer && getAccessToken() === token && timeLeft(token) > 0) {
      timer = setTimeout(schedule, Math.min(RETRY_DELAY_MS, timeLeft(token)));
    }
  }, delay);
}

async function sendPendingSignOut() {
  await withLock(async () => {
    if (!isSignOutPending()) return;
    try {
      await webSessionClient.signOut();
      setSignOutPending(false);
    } catch {
      // Keep the flag: retried on the next boot, and no auto-refresh meanwhile.
    }
  });
}

export async function signIn(credentials) {
  return withLock(async () => {
    const response = await webSessionClient.signIn(credentials);
    // The server ends any session whose cookie this sign-in replaces.
    setSignOutPending(false);
    establishSession(response.data.token, response.data.email);
    return response;
  });
}

export async function signOut() {
  setSignOutPending(true);
  clearTimeout(timer);
  timer = null;
  clearSession();
  broadcastSignedOut();
  await sendPendingSignOut();
}

// Boot status for the loading view. While a stored identity exists and no token
// is held, `pending` stays true until the refresh settles: the user is never sent
// to sign-in because the server is slow or unreachable. Without a stored identity
// `pending` ends after BOOT_WAIT_MS (a late refresh still signs in).
let loading = false;
let hadIdentity = false;
let capReached = false;
let slow = false;
let unreachable = false;

function publishBootStatus() {
  const pending = loading && !getAccessToken() && (hasStoredIdentity() || (!hadIdentity && !capReached));
  const next = { pending, slow: pending && slow, unreachable: pending && unreachable };
  if (next.pending === bootStatus.pending && next.slow === bootStatus.slow && next.unreachable === bootStatus.unreachable) return;
  bootStatus = Object.freeze(next);
  bootListeners.forEach((listener) => listener());
}

export function getBootStatus() {
  return bootStatus;
}

export function isBootRefreshPending() {
  return bootStatus.pending;
}

export function subscribeToBootRefresh(listener) {
  bootListeners.add(listener);
  return () => bootListeners.delete(listener);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// This tab holds no token but a sign-in is stored (page load, or another tab
// signed in and this tab dropped its token): get a token through the cookie.
function needsRestore() {
  return !isSignOutPending() && !getAccessToken() && hasStoredIdentity();
}

function restoreSession() {
  if (restoring) return restoring;

  restoring = (async () => {
    loading = true;
    hadIdentity = hasStoredIdentity();
    capReached = false;
    slow = false;
    unreachable = false;
    publishBootStatus();
    const timer = setTimeout(() => {
      capReached = true;
      slow = true;
      publishBootStatus();
    }, BOOT_WAIT_MS);

    let failures = 0;
    let discarded = 0;
    try {
      for (;;) {
        const refreshed = await refreshWebSession({ triggerToken: null, reason: "boot" });
        if (refreshed || getAccessToken()) break;
        // Retry only while an identity is stored: the cookie may still be valid.
        if (isSignOutPending() || !hasStoredIdentity()) break;

        if (lastFailure === "superseded" && discarded < MAX_IMMEDIATE_RETRIES) {
          discarded += 1;
          continue;
        }
        unreachable = true;
        publishBootStatus();
        await wait(Math.min(BOOT_RETRY_BASE_MS * 2 ** failures, BOOT_RETRY_MAX_MS));
        failures += 1;
      }
    } finally {
      clearTimeout(timer);
      loading = false;
      restoring = null;
      publishBootStatus();
    }
  })();
  return restoring;
}

function handleMessage(event) {
  if (event?.data?.type !== "signed-out") return;
  clearTimeout(timer);
  timer = null;
  if (getAccessToken()) clearSession();
  else syncSessionFromStorage();
}

function handleVisibility() {
  if (document.visibilityState === "visible") schedule();
}

function onSessionChange() {
  schedule();
  publishBootStatus();
  if (needsRestore()) void restoreSession();
}

async function boot() {
  // The access token is no longer stored; remove any left by an earlier version.
  removeLegacyAccessToken();

  if (isSignOutPending()) {
    // Finish an earlier sign-out before anything else; never refresh while set.
    await sendPendingSignOut();
    return;
  }

  // Always refresh once: the HttpOnly cookie is the only durable credential and
  // the token is memory-only, so every load gets a new one (also covers a
  // cookie that outlived the stored identity).
  await restoreSession();
  schedule();
}

export function startWebSession() {
  if (started) return bootPromise;
  started = true;

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
    channel.addEventListener("message", handleMessage);
  }
  subscribeToSession(onSessionChange);
  document.addEventListener("visibilitychange", handleVisibility);

  bootPromise = boot();
  return bootPromise;
}
