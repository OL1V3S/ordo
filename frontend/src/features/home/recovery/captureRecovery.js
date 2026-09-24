import { useCallback, useSyncExternalStore } from "react";
import { getSessionSnapshot, subscribeToSession } from "../../../shared/auth/session";

const PREFIX = "ordo-home-uncertain-write:";
const listeners = new Set();
const volatileMarkers = new Map();
let lastSession = getSessionSnapshot();
const accountKey = (session) => session?.token && session?.email
  ? `${PREFIX}${encodeURIComponent(session.email.trim().toLowerCase())}` : null;

function emit() { listeners.forEach((listener) => listener()); }
function* availableStorages() {
  for (const name of ["sessionStorage", "localStorage"]) {
    try { yield window[name]; } catch { /* Storage may be disabled for this origin. */ }
  }
}
function readForKey(key) {
  if (!key) return null;
  const volatile = volatileMarkers.get(key);
  if (volatile === "expense" || volatile === "account_inflow") return volatile;
  for (const storage of availableStorages()) {
    try {
      const source = storage.getItem(key);
      if (source === "expense" || source === "account_inflow") return source;
    } catch { /* Try the next storage or the in-memory fallback. */ }
  }
  return null;
}
function read() {
  return readForKey(accountKey(getSessionSnapshot()));
}
function clearForKey(key) {
  if (!key) return;
  volatileMarkers.delete(key);
  for (const storage of availableStorages()) {
    try { storage.removeItem(key); } catch { /* A remaining marker keeps the recovery gate fail-closed. */ }
  }
}
function sessionChanged() {
  const current = getSessionSnapshot();
  if (current !== lastSession) {
    const priorKey = accountKey(lastSession);
    if (priorKey && priorKey !== accountKey(current)) {
      clearForKey(priorKey);
    }
    lastSession = current;
    emit();
  }
}
subscribeToSession(sessionChanged);
window.addEventListener("storage", (event) => {
  if (event.key?.startsWith(PREFIX)) emit();
});

export function subscribeToCaptureRecovery(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getCaptureRecoverySnapshot() { return read(); }
export function getCaptureRecoveryVolatileSnapshot() {
  const key = accountKey(getSessionSnapshot());
  return Boolean(key && volatileMarkers.has(key));
}
export function markCaptureRecovery(source, expectedSession = getSessionSnapshot()) {
  if (source !== "expense" && source !== "account_inflow") return false;
  const currentSession = getSessionSnapshot();
  if (expectedSession !== currentSession) return false;
  const key = accountKey(currentSession);
  if (!key) return false;
  volatileMarkers.delete(key);
  try {
    sessionStorage.setItem(key, source);
    emit();
    return true;
  } catch {
    try {
      localStorage.setItem(key, source);
      emit();
      return true;
    } catch {
      volatileMarkers.set(key, source);
      emit();
      return false;
    }
  }
}
export function clearCaptureRecovery(expectedSession = getSessionSnapshot()) {
  const currentSession = getSessionSnapshot();
  if (expectedSession !== currentSession) return false;
  const key = accountKey(currentSession);
  if (!key) return false;
  clearForKey(key);
  const cleared = readForKey(key) === null;
  emit();
  return cleared;
}
export function useCaptureRecovery() {
  const session = useSyncExternalStore(subscribeToSession, getSessionSnapshot);
  const source = useSyncExternalStore(subscribeToCaptureRecovery, getCaptureRecoverySnapshot);
  const volatile = useSyncExternalStore(subscribeToCaptureRecovery, getCaptureRecoveryVolatileSnapshot);
  const mark = useCallback((kind) => markCaptureRecovery(kind, session), [session]);
  const clear = useCallback(() => clearCaptureRecovery(session), [session]);
  return { source, volatile, mark, clear };
}
