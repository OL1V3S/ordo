// Web-session orchestration (#292): sign-in, refresh and sign-out against the
// same-origin web-session endpoints. The long-lived credential stays in an
// HttpOnly cookie; only the 2-hour access token is kept in localStorage.
// Never log tokens.
import { webSessionClient } from "../api/webSessionClient";
import {
  clearSession,
  establishSession,
  getAccessToken,
  getSessionSnapshot,
  replaceAccessToken,
  subscribeToSession,
  syncSessionFromStorage,
} from "./session";

export const REFRESH_LOCK_NAME = "ordo-web-session-refresh";
export const SESSION_CHANNEL_NAME = "ordo-session";
export const PENDING_SIGN_OUT_KEY = "pending-sign-out";
export const REFRESH_LEAD_MS = 5 * 60 * 1000;
// Inside the lock, a token with more than this left was refreshed by another tab.
const FRESH_ENOUGH_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;
const BOOT_WAIT_MS = 4000;

let inFlight = null;
let timer = null;
let channel = null;
let started = false;
let bootPromise = null;
let bootPending = false;
const bootListeners = new Set();

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

async function runRefresh(triggerToken, reason) {
  if (isSignOutPending()) return false;

  // Re-read inside the lock: another tab may already have refreshed.
  const stored = getAccessToken();
  if (stored && stored !== triggerToken) return true;
  if (stored && reason !== "unauthorized" && timeLeft(stored) > FRESH_ENOUGH_MS) return true;

  const before = getSessionSnapshot();
  let response;
  try {
    response = await webSessionClient.refresh();
  } catch (error) {
    if (!sameSignIn(before)) return false;
    if (error?.response?.status === 401) {
      // The session ended: sign out everywhere.
      if (before.signedIn) {
        clearSession();
        broadcastSignedOut();
      }
    } else if (before.signedIn && timeLeft(getAccessToken()) <= 0) {
      // Fail closed: a network error or 5xx never keeps an expired token.
      clearSession();
    }
    return false;
  }

  const { token, email } = response.data ?? {};
  if (isSignOutPending() || !sameSignIn(before) || typeof token !== "string" || !token) return false;

  if (before.signedIn) replaceAccessToken(token, email);
  else establishSession(token, email);
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

  const delay = Math.max(0, timeLeft(token) - REFRESH_LEAD_MS);
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

function setBootPending(pending) {
  if (bootPending === pending) return;
  bootPending = pending;
  bootListeners.forEach((listener) => listener());
}

export function isBootRefreshPending() {
  return bootPending;
}

export function subscribeToBootRefresh(listener) {
  bootListeners.add(listener);
  return () => bootListeners.delete(listener);
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

async function boot() {
  if (isSignOutPending()) {
    // Finish an earlier sign-out before anything else; never refresh while set.
    await sendPendingSignOut();
    return;
  }

  const token = getAccessToken();
  if (!token || timeLeft(token) <= 0) {
    // Always try once: the HttpOnly cookie can outlive localStorage.
    setBootPending(true);
    const cap = setTimeout(() => setBootPending(false), BOOT_WAIT_MS);
    try {
      await refreshWebSession({ triggerToken: token, reason: "boot" });
    } finally {
      clearTimeout(cap);
      setBootPending(false);
    }
  }
  schedule();
}

export function startWebSession() {
  if (started) return bootPromise;
  started = true;

  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(SESSION_CHANNEL_NAME);
    channel.addEventListener("message", handleMessage);
  }
  subscribeToSession(schedule);
  document.addEventListener("visibilitychange", handleVisibility);

  bootPromise = boot();
  return bootPromise;
}
