import { useCallback, useSyncExternalStore } from "react";
import { getSessionSnapshot, subscribeToSession } from "../../../shared/auth/session";

const PREFIX = "ordo-home-uncertain-write:";
const listeners = new Set();
let lastSession = getSessionSnapshot();
const accountKey = (session) => session?.token && session?.email
  ? `${PREFIX}${encodeURIComponent(session.email.trim().toLowerCase())}` : null;

function emit() { listeners.forEach((listener) => listener()); }
function read() {
  const key = accountKey(getSessionSnapshot());
  if (!key) return null;
  try {
    const source = sessionStorage.getItem(key);
    return source === "expense" || source === "account_inflow" ? source : null;
  } catch { return null; }
}
function sessionChanged() {
  const current = getSessionSnapshot();
  if (current !== lastSession) {
    const priorKey = accountKey(lastSession);
    if (priorKey && priorKey !== accountKey(current)) {
      try { sessionStorage.removeItem(priorKey); } catch { /* session storage may be unavailable */ }
    }
    lastSession = current;
    emit();
  }
}
subscribeToSession(sessionChanged);

export function subscribeToCaptureRecovery(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getCaptureRecoverySnapshot() { return read(); }
export function markCaptureRecovery(source) {
  if (source !== "expense" && source !== "account_inflow") return false;
  const key = accountKey(getSessionSnapshot());
  if (!key) return false;
  try { sessionStorage.setItem(key, source); emit(); return true; } catch { return false; }
}
export function clearCaptureRecovery() {
  const key = accountKey(getSessionSnapshot());
  if (!key) return false;
  try { sessionStorage.removeItem(key); emit(); return true; } catch { return false; }
}
export function useCaptureRecovery() {
  useSyncExternalStore(subscribeToSession, getSessionSnapshot);
  const source = useSyncExternalStore(subscribeToCaptureRecovery, getCaptureRecoverySnapshot);
  const mark = useCallback((kind) => markCaptureRecovery(kind), []);
  const clear = useCallback(() => clearCaptureRecovery(), []);
  return { source, mark, clear };
}
