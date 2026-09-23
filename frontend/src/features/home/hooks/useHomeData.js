import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSessionSnapshot, subscribeToSession } from "../../../shared/auth/session";
import { localThroughDate } from "../../analytics/utils/cashFlowPresentation";
import { homeApi } from "../api/homeApi";
import { isHomeResponse } from "../utils/homePresentation";

export function useHomeData() {
  const session = useSyncExternalStore(subscribeToSession, getSessionSnapshot);
  const [state, setState] = useState(null);
  const latest = useRef(0);
  const activeController = useRef(null);

  const read = useCallback(async (readSession) => {
    if (!readSession?.token || readSession !== getSessionSnapshot()) return { stale: true };

    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++latest.current;
    const activityThroughDate = localThroughDate();
    const current = () => requestId === latest.current
      && readSession === getSessionSnapshot()
      && !controller.signal.aborted;

    setState({ session: readSession, activityThroughDate, loading: true, data: null, error: false });
    try {
      const response = await homeApi.getHome(activityThroughDate, controller.signal);
      if (!current()) return { stale: true };
      if (!isHomeResponse(response?.data)) throw new Error("Invalid Home response.");
      setState({ session: readSession, activityThroughDate, loading: false, data: response.data, error: false });
      return { stale: false, failed: false, data: response.data };
    } catch {
      if (!current()) return { stale: true };
      setState({ session: readSession, activityThroughDate, loading: false, data: null, error: true });
      return { stale: false, failed: true };
    } finally {
      if (activeController.current === controller) activeController.current = null;
    }
  }, []);

  useEffect(() => {
    if (!session.token) {
      latest.current += 1;
      activeController.current?.abort();
      activeController.current = null;
      setState({ session, activityThroughDate: null, loading: false, data: null, error: false });
      return undefined;
    }

    void read(session);
    return () => {
      latest.current += 1;
      activeController.current?.abort();
      activeController.current = null;
    };
  }, [read, session]);

  const refresh = useCallback(() => read(session), [read, session]);
  const matches = state?.session === session;

  return {
    data: matches ? state.data : null,
    loading: matches ? state.loading : Boolean(session.token),
    error: matches ? state.error : false,
    activityThroughDate: matches ? state.activityThroughDate : null,
    refresh,
  };
}
