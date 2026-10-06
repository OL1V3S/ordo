import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getSessionSnapshot, subscribeToSession } from "../../../shared/auth/session";
import { activityTimelineApi } from "../api/activityTimelineApi";
import { EMPTY_TIMELINE_FILTER, timelineFilterParams, timelineFilterKey } from "../utils/timelineFilter";
import {
  ACTIVITY_TIMELINE_PAGE_SIZE,
  isActivityTimelinePage,
  timelineItemKey,
} from "../utils/timelinePresentation";

const NO_ITEMS = Object.freeze([]);
const FLAGS = {
  loading: false, error: false, refreshFailed: false, malformed: false,
  loadingMore: false, loadMoreFailed: false,
};

// Session-scoped, read-only timeline state. It never throws to callers: refresh and
// loadMore resolve with { stale, failed } so write flows can fire them without gating.
// The applied filter is part of the state: rows, cursor and hasMore are only ever reused or
// continued under the same session AND the same filter, so a filter change never shows or pages
// from the previous filter's results.
export function useActivityTimeline({ enabled = true, filter = EMPTY_TIMELINE_FILTER } = {}) {
  const filterKey = timelineFilterKey(filter);
  const appliedFilter = useMemo(() => {
    const [q, kind, from, to] = JSON.parse(filterKey);
    return { q, kind, from, to };
  }, [filterKey]);
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;
  const session = useSyncExternalStore(subscribeToSession, getSessionSnapshot);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [state, setState] = useState(null);
  const stateRef = useRef(null);
  const latest = useRef(0);
  const activeController = useRef(null);

  const commit = useCallback((next) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const invalidate = useCallback(() => {
    latest.current += 1;
    activeController.current?.abort();
    activeController.current = null;
  }, []);

  const begin = useCallback((readSession) => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++latest.current;
    const current = () => requestId === latest.current
      && readSession === getSessionSnapshot()
      && readSession === sessionRef.current
      && !controller.signal.aborted;
    return { controller, current };
  }, []);

  const readFirst = useCallback(async (readSession) => {
    if (!enabled || !readSession?.token || readSession !== getSessionSnapshot()) return { stale: true };

    const { controller, current } = begin(readSession);
    const previous = stateRef.current?.session === readSession && stateRef.current.filterKey === filterKey
      ? stateRef.current : null;
    const scope = { filterKey, filter: appliedFilter };
    commit({
      session: readSession,
      ...scope,
      items: previous?.items ?? NO_ITEMS,
      nextCursor: previous?.nextCursor ?? null,
      hasMore: previous?.hasMore ?? false,
      ...FLAGS,
      loading: true,
    });

    try {
      let response;
      try {
        response = await activityTimelineApi.get(
          { limit: ACTIVITY_TIMELINE_PAGE_SIZE, ...timelineFilterParams(appliedFilter) },
          controller.signal,
        );
      } catch {
        if (!current()) return { stale: true };
        const rowsKept = (previous?.items.length ?? 0) > 0;
        commit({
          session: readSession,
          ...scope,
          items: previous?.items ?? NO_ITEMS,
          nextCursor: previous?.nextCursor ?? null,
          hasMore: previous?.hasMore ?? false,
          ...FLAGS,
          error: !rowsKept,
          refreshFailed: rowsKept,
        });
        return { stale: false, failed: true };
      }
      if (!current()) return { stale: true };

      if (!isActivityTimelinePage(response?.data)) {
        commit({ session: readSession, ...scope, items: NO_ITEMS, nextCursor: null, hasMore: false, ...FLAGS, malformed: true });
        return { stale: false, failed: true, malformed: true };
      }

      const { items, page } = response.data;
      commit({
        session: readSession,
        ...scope,
        items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        ...FLAGS,
      });
      return { stale: false, failed: false };
    } finally {
      if (activeController.current === controller) activeController.current = null;
    }
  }, [appliedFilter, begin, commit, enabled, filterKey]);

  const loadMore = useCallback(async () => {
    const readSession = sessionRef.current;
    const base = stateRef.current;
    if (!enabled || !readSession?.token || readSession !== getSessionSnapshot() || base?.session !== readSession
        || base.filterKey !== filterKeyRef.current || !base.hasMore || !base.nextCursor || base.loading || base.loadingMore) return { stale: true };

    const { controller, current } = begin(readSession);
    commit({ ...base, ...FLAGS, loadingMore: true });

    try {
      let response;
      try {
        response = await activityTimelineApi.get(
          { limit: ACTIVITY_TIMELINE_PAGE_SIZE, cursor: base.nextCursor, ...timelineFilterParams(base.filter) },
          controller.signal,
        );
      } catch {
        if (!current()) return { stale: true };
        commit({ ...base, ...FLAGS, loadMoreFailed: true });
        return { stale: false, failed: true };
      }
      if (!current()) return { stale: true };

      if (!isActivityTimelinePage(response?.data)) {
        commit({
          session: readSession, filterKey: base.filterKey, filter: base.filter,
          items: NO_ITEMS, nextCursor: null, hasMore: false, ...FLAGS, malformed: true,
        });
        return { stale: false, failed: true, malformed: true };
      }

      // A record edited on another device between page reads could repeat; never render it twice.
      const seen = new Set(base.items.map(timelineItemKey));
      const appended = response.data.items.filter((item) => !seen.has(timelineItemKey(item)));
      commit({
        session: readSession,
        filterKey: base.filterKey,
        filter: base.filter,
        items: [...base.items, ...appended],
        nextCursor: response.data.page.nextCursor,
        hasMore: response.data.page.hasMore,
        ...FLAGS,
      });
      return { stale: false, failed: false };
    } finally {
      if (activeController.current === controller) activeController.current = null;
    }
  }, [begin, commit, enabled]);

  useEffect(() => {
    if (!enabled || !session.token) {
      invalidate();
      commit(null);
      return undefined;
    }

    void readFirst(session);
    return invalidate;
  }, [commit, enabled, invalidate, readFirst, session]);

  const refresh = useCallback(() => readFirst(sessionRef.current), [readFirst]);
  const matches = enabled && state?.session === session && state.filterKey === filterKey;

  return {
    items: matches ? state.items : NO_ITEMS,
    hasMore: matches ? state.hasMore : false,
    loading: enabled ? (matches ? state.loading : Boolean(session.token)) : false,
    error: matches ? state.error : false,
    refreshFailed: matches ? state.refreshFailed : false,
    malformed: matches ? state.malformed : false,
    loadingMore: matches ? state.loadingMore : false,
    loadMoreFailed: matches ? state.loadMoreFailed : false,
    // The filter the visible rows were read under; null until a read for the current filter commits.
    appliedFilter: matches ? state.filter : null,
    loadMore,
    refresh,
  };
}
