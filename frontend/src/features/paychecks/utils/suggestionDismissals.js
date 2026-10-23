import { useCallback, useSyncExternalStore } from "react";
import { getAccessToken, getSessionSnapshot, subscribeToSession } from "../../../shared/auth/session";

// Device-local "dismissed match" memory for paycheck suggestions. Nothing here reaches the server.
// Stored values are `<scheduleId>|<slotAnchor>|<depositId>` only. The storage key uses the opaque
// account identifier carried by the session token (never the email or any description) and is
// intentionally not cleared on logout, so a dismissal survives signing out and back in.
const PREFIX = "ordo-paycheck-suggestion-dismissals:";
export const MAX_DISMISSALS = 200;
const VALUE = /^[^|]+\|\d{4}-\d{2}-\d{2}\|\d+$/;
const NAMEIDENTIFIER = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier";

const listeners = new Set();
const memory = new Map(); // storage key -> array of values (fallback when storage is unavailable)
const snapshots = new Map(); // storage key -> { signature, set }
const degraded = new Set(); // storage keys whose last write failed; memory is authoritative
const EMPTY = new Set();

function decodeAccountId(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const claims = JSON.parse(decodeURIComponent(Array.from(atob(base64), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
    const id = claims?.[NAMEIDENTIFIER] ?? claims?.nameid ?? claims?.sub;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

// A persistent key needs an opaque account id. Without one the dismissals stay in memory only,
// scoped to the sign-in, and are never written to storage.
function accountScope(session) {
  if (!session?.signedIn) return null;
  const token = getAccessToken();
  const id = token ? decodeAccountId(token) : null;
  return id ? { key: `${PREFIX}${encodeURIComponent(id)}`, persistent: true }
    : { key: `volatile:${session.id}`, persistent: false };
}

function emit() { listeners.forEach((listener) => listener()); }

function sanitize(values) {
  if (!Array.isArray(values)) return [];
  const clean = [];
  for (const value of values) if (typeof value === "string" && VALUE.test(value) && !clean.includes(value)) clean.push(value);
  return clean.slice(-MAX_DISMISSALS);
}

function readValues(scope) {
  if (scope.persistent && !degraded.has(scope.key)) {
    try {
      const raw = window.localStorage.getItem(scope.key);
      if (raw === null) return [];
      try { return sanitize(JSON.parse(raw)); } catch { return []; }
    } catch { /* Storage may be disabled; use the in-memory fallback. */ }
  }
  return memory.get(scope.key) ?? [];
}

function writeValues(scope, values) {
  memory.set(scope.key, values);
  if (!scope.persistent) return;
  try {
    if (values.length) window.localStorage.setItem(scope.key, JSON.stringify(values));
    else window.localStorage.removeItem(scope.key);
    degraded.delete(scope.key);
  } catch {
    // The in-memory copy keeps the dismissal for this page session.
    degraded.add(scope.key);
  }
}

function snapshotFor(scope) {
  if (!scope) return EMPTY;
  const values = readValues(scope);
  const signature = values.join("\n");
  const cached = snapshots.get(scope.key);
  if (cached && cached.signature === signature) return cached.set;
  const set = new Set(values);
  snapshots.set(scope.key, { signature, set });
  return set;
}

function mutate(scope, change) {
  if (!scope) return;
  const current = readValues(scope);
  const next = sanitize(change(current));
  if (next.length === current.length && next.every((value, index) => value === current[index])) return;
  writeValues(scope, next);
  emit();
}

export function dismissSuggestion(session, value) {
  if (!VALUE.test(value)) return;
  mutate(accountScope(session), (values) => [...values.filter((existing) => existing !== value), value]);
}

export function restoreSuggestion(session, value) {
  mutate(accountScope(session), (values) => values.filter((existing) => existing !== value));
}

// Call only after a fully successful read of schedules and deposits. `isCurrent(value)` is false
// for a dismissal whose deposit, active schedule or slot no longer exists.
export function pruneDismissals(session, isCurrent) {
  mutate(accountScope(session), (values) => values.filter((value) => isCurrent(value)));
}

export function readDismissals(session) {
  return snapshotFor(accountScope(session));
}

export function resetDismissalsForTests() {
  memory.clear();
  snapshots.clear();
  degraded.clear();
}

export function parseDismissal(value) {
  const [profileId, slotAnchor, inflowId] = value.split("|");
  return { profileId, slotAnchor, inflowId };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith(PREFIX)) emit();
  });
}

function subscribe(listener) {
  listeners.add(listener);
  const unsubscribeSession = subscribeToSession(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeSession();
  };
}

export function useSuggestionDismissals() {
  const session = useSyncExternalStore(subscribe, getSessionSnapshot, getSessionSnapshot);
  const dismissed = useSyncExternalStore(subscribe, () => snapshotFor(accountScope(getSessionSnapshot())), () => EMPTY);
  const dismiss = useCallback((value) => dismissSuggestion(getSessionSnapshot(), value), []);
  const restore = useCallback((value) => restoreSuggestion(getSessionSnapshot(), value), []);
  const prune = useCallback((isCurrent) => pruneDismissals(getSessionSnapshot(), isCurrent), []);
  return { dismissed, dismiss, restore, prune, session };
}
