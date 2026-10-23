import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSessionSnapshot, subscribeToSession } from "../../../shared/auth/session";
import { inflowsApi } from "../api/inflowsApi";

function completedWrite(response, extra = {}) {
  const outcome = { refreshFailed: false, ...extra };
  if (response?.data && typeof response.data === "object") outcome.record = response.data;
  return outcome;
}

export function useInflows() {
  const session = useSyncExternalStore(subscribeToSession, getSessionSnapshot);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [state, setState] = useState(null);
  const mounted = useRef(false);
  const latestRead = useRef(0);
  const activeController = useRef(null);
  const writeInFlight = useRef(false);

  const invalidateRead = useCallback(() => {
    latestRead.current += 1;
    activeController.current?.abort();
    activeController.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidateRead();
    };
  }, [invalidateRead]);

  const load = useCallback(async (readSession = session) => {
    if (!mounted.current || readSession !== getSessionSnapshot() || readSession !== sessionRef.current) {
      return { stale: true };
    }

    invalidateRead();
    const id = latestRead.current;
    setState((previous) => ({
      session: readSession,
      inflows: previous?.session === readSession ? previous.inflows : [],
      loading: Boolean(readSession.signedIn),
      error: null,
    }));

    if (!readSession.signedIn) return { stale: true };

    const controller = new AbortController();
    activeController.current = controller;
    const current = () => mounted.current
      && id === latestRead.current
      && readSession === getSessionSnapshot()
      && readSession === sessionRef.current;

    try {
      const response = await inflowsApi.getAll(controller.signal);
      if (!current()) return { stale: true };
      if (!Array.isArray(response?.data)) throw new Error("Invalid inflow list response.");
      setState({
        session: readSession,
        inflows: response.data,
        loading: false,
        error: null,
      });
      return { stale: false };
    } catch (error) {
      if (!current()) return { stale: true };
      setState((previous) => ({ ...previous, loading: false, error }));
      throw error;
    } finally {
      if (activeController.current === controller) activeController.current = null;
    }
  }, [invalidateRead, session]);

  useEffect(() => {
    load().catch(() => {});
    return invalidateRead;
  }, [invalidateRead, load]);

  const perform = useCallback(async (operation) => {
    if (writeInFlight.current) throw new Error("An inflow write is already in progress.");
    const writeSession = getSessionSnapshot();
    if (!mounted.current || !writeSession.signedIn || writeSession !== sessionRef.current) {
      return { refreshFailed: false, stale: true };
    }

    writeInFlight.current = true;
    invalidateRead();
    try {
      const response = await operation();
      const base = completedWrite(response);
      if (!mounted.current || writeSession !== getSessionSnapshot() || writeSession !== sessionRef.current) {
        return { ...base, stale: true };
      }
      try {
        const refresh = await load(writeSession);
        if (!refresh.stale) return base;
        if (!mounted.current || writeSession !== getSessionSnapshot() || writeSession !== sessionRef.current) {
          return { ...base, stale: true };
        }
        // Another same-session read superseded the post-write refresh. The write
        // is complete, but this caller cannot claim that its refresh succeeded.
        return { ...base, refreshFailed: true };
      } catch {
        return { ...base, refreshFailed: true };
      }
    } finally {
      writeInFlight.current = false;
    }
  }, [invalidateRead, load]);

  const createInflow = useCallback((payload) => perform(() => inflowsApi.create(payload)), [perform]);
  const updateInflow = useCallback((id, payload) => perform(() => inflowsApi.update(id, payload)), [perform]);
  const deleteInflow = useCallback((id) => perform(() => inflowsApi.remove(id)), [perform]);
  const refresh = useCallback(() => load(session), [load, session]);

  const matches = state?.session === session;
  return {
    inflows: matches ? state.inflows : [],
    loading: !matches || state.loading,
    error: matches ? state.error : null,
    refresh,
    createInflow,
    updateInflow,
    deleteInflow,
  };
}
