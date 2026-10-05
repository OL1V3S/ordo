import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getSessionSnapshot, subscribeToSession } from "../../../shared/auth/session";
import { cashFlowApi } from "../api/cashFlowApi";
import { localThroughDate } from "../utils/cashFlowPresentation";

export function useCashFlow(month) {
  const { t } = useTranslation("analytics");
  const session = useSyncExternalStore(subscribeToSession, getSessionSnapshot);
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const id = ++latest.current;
    const controller = new AbortController();
    const throughDate = localThroughDate();
    const current = () => id === latest.current && session === getSessionSnapshot();
    setState((previous) => ({
      month, session, attempt, loading: true, data: null, error: null,
      availableMonths: previous?.session === session ? previous.availableMonths : [],
    }));

    if (!session.token) {
      setState({ month, session, attempt, loading: false, data: null, availableMonths: [], error: "cashFlow.errors.signIn" });
      return () => { latest.current += 1; controller.abort(); };
    }

    cashFlowApi.get(month, throughDate, controller.signal).then(({ data }) => {
      if (!current()) return;
      // A response for another period must never be presented under this filter.
      if (data.month !== month || data.throughDate !== throughDate) throw new Error("Cash-flow period mismatch");
      setState({ month, session, attempt, loading: false, data, error: null, availableMonths: data.availableMonths });
    }).catch(() => {
      if (!current()) return;
      setState((previous) => ({ ...previous, loading: false, data: null,
        error: "cashFlow.errors.loadFailed" }));
    });

    return () => { latest.current += 1; controller.abort(); };
  }, [month, session, attempt]);

  // Hide the old snapshot on the very first render of a new month/session/refresh.
  const matches = state?.month === month && state?.session === session && state?.attempt === attempt;
  return {
    data: matches ? state.data : null,
    loading: !matches || state.loading,
    // State keeps a catalog key; it is resolved here so a message follows a language change.
    error: matches && state.error ? t(state.error) : null,
    availableMonths: state?.session === session ? state.availableMonths : [],
    refresh,
  };
}
