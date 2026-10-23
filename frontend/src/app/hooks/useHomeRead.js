import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSessionSnapshot, subscribeToSession } from "../../shared/auth/session";

export function useHomeRead(load, key = null) {
  const session = useSyncExternalStore(subscribeToSession, getSessionSnapshot);
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const id = ++latest.current;
    const current = () => id === latest.current && session === getSessionSnapshot();
    const identity = { load, key, session, attempt };
    const fail = () => {
      if (current()) setState({ ...identity, loading: false, data: null, error: true });
    };

    setState({ ...identity, loading: true, data: null, error: false });

    if (!session.signedIn) {
      setState({ ...identity, loading: false, data: null, error: false });
      return () => { latest.current += 1; };
    }

    let request;
    try {
      request = load(key);
    } catch {
      fail();
      return () => { latest.current += 1; };
    }

    Promise.resolve(request).then(({ data }) => {
      if (current()) setState({ ...identity, loading: false, data, error: false });
    }).catch(fail);

    return () => { latest.current += 1; };
  }, [load, key, session, attempt]);

  const matches = state?.load === load
    && state?.key === key
    && state?.session === session
    && state?.attempt === attempt;

  return {
    data: matches ? state.data : null,
    loading: !matches || state.loading,
    error: matches ? state.error : false,
    refresh,
  };
}
