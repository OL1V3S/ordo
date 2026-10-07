import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, establishSession } from "../../../shared/auth/session";
import { activityTimelineApi } from "../api/activityTimelineApi";
import { useActivityTimeline } from "./useActivityTimeline";

vi.mock("../api/activityTimelineApi", () => ({ activityTimelineApi: { get: vi.fn() } }));

const row = (recordId, overrides = {}) => ({
  kind: "expense", recordId, date: "2026-09-22", amount: "1.00",
  description: `Row ${recordId}`, category: "food", paycheck: null, ...overrides,
});
const pageOf = (items, { hasMore = false, nextCursor = null } = {}) => ({
  data: { currencyCode: "USD", items, page: { limit: 25, hasMore, nextCursor } },
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("useActivityTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    establishSession("session-a", "timeline@example.test");
    activityTimelineApi.get.mockResolvedValue(pageOf([row(1), row(2)]));
  });
  afterEach(() => clearSession());

  it("loads the first page with the page size and an abort signal", async () => {
    const { result } = renderHook(() => useActivityTimeline());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    expect(activityTimelineApi.get).toHaveBeenCalledWith({ limit: 25 }, expect.any(AbortSignal));
    expect(result.current).toMatchObject({ loading: false, error: false, hasMore: false, malformed: false });
  });

  it("loads older pages with the returned cursor, appends them, and never repeats a record", async () => {
    activityTimelineApi.get
      .mockResolvedValueOnce(pageOf([row(1), row(2)], { hasMore: true, nextCursor: "cursor-1" }))
      .mockResolvedValueOnce(pageOf([row(2), row(3)]));
    const { result } = renderHook(() => useActivityTimeline());
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    await act(async () => { await result.current.loadMore(); });

    expect(activityTimelineApi.get).toHaveBeenLastCalledWith({ limit: 25, cursor: "cursor-1" }, expect.any(AbortSignal));
    expect(result.current.items.map((item) => item.recordId)).toEqual([1, 2, 3]);
    expect(result.current.hasMore).toBe(false);
  });

  it("ignores loadMore when there is nothing older or a read is already running", async () => {
    const { result } = renderHook(() => useActivityTimeline());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    const outcome = await act(async () => result.current.loadMore());

    expect(outcome).toEqual({ stale: true });
    expect(activityTimelineApi.get).toHaveBeenCalledTimes(1);
  });

  it("resets to the first page on refresh", async () => {
    activityTimelineApi.get
      .mockResolvedValueOnce(pageOf([row(1), row(2)], { hasMore: true, nextCursor: "cursor-1" }))
      .mockResolvedValueOnce(pageOf([row(3)]))
      .mockResolvedValueOnce(pageOf([row(9), row(1)], { hasMore: true, nextCursor: "cursor-9" }));
    const { result } = renderHook(() => useActivityTimeline());
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items).toHaveLength(3);

    const refreshed = await act(async () => result.current.refresh());

    expect(refreshed).toEqual({ stale: false, failed: false });
    expect(result.current.items.map((item) => item.recordId)).toEqual([9, 1]);
    expect(result.current.hasMore).toBe(true);
    expect(activityTimelineApi.get).toHaveBeenLastCalledWith({ limit: 25 }, expect.any(AbortSignal));
  });

  it("reports an initial failure without rows and recovers on retry", async () => {
    activityTimelineApi.get.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useActivityTimeline());
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current).toMatchObject({ items: [], loading: false, refreshFailed: false });

    const retried = await act(async () => result.current.refresh());

    expect(retried).toEqual({ stale: false, failed: false });
    expect(result.current).toMatchObject({ error: false });
    expect(result.current.items).toHaveLength(2);
  });

  it("keeps the rows and flags a failed refresh without throwing", async () => {
    const { result } = renderHook(() => useActivityTimeline());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    activityTimelineApi.get.mockRejectedValueOnce(new Error("offline"));

    const refreshed = await act(async () => result.current.refresh());

    expect(refreshed).toEqual({ stale: false, failed: true });
    expect(result.current).toMatchObject({ error: false, refreshFailed: true, loading: false });
    expect(result.current.items).toHaveLength(2);
  });

  it("keeps the rows after a failed older-page read and lets it be retried", async () => {
    activityTimelineApi.get
      .mockResolvedValueOnce(pageOf([row(1), row(2)], { hasMore: true, nextCursor: "cursor-1" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(pageOf([row(3)]));
    const { result } = renderHook(() => useActivityTimeline());
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    await act(async () => { await result.current.loadMore(); });
    expect(result.current).toMatchObject({ loadMoreFailed: true, loadingMore: false, hasMore: true });
    expect(result.current.items).toHaveLength(2);

    await act(async () => { await result.current.loadMore(); });
    expect(result.current.loadMoreFailed).toBe(false);
    expect(result.current.items.map((item) => item.recordId)).toEqual([1, 2, 3]);
  });

  it("fails closed on a malformed response and clears rows already shown", async () => {
    const { result } = renderHook(() => useActivityTimeline());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    activityTimelineApi.get.mockResolvedValueOnce({ data: { currencyCode: "USD", items: [{ kind: "expense" }], page: {} } });

    const refreshed = await act(async () => result.current.refresh());

    expect(refreshed).toMatchObject({ stale: false, failed: true, malformed: true });
    expect(result.current).toMatchObject({ items: [], malformed: true, hasMore: false, error: false });
  });

  it("keeps a legacy zero or negative amount row instead of blanking the page", async () => {
    activityTimelineApi.get.mockResolvedValue(pageOf([row(1, { amount: "0.00" }), row(2, { amount: "-5.00" })]));
    const { result } = renderHook(() => useActivityTimeline());

    await waitFor(() => expect(result.current.items).toHaveLength(2));

    expect(result.current.malformed).toBe(false);
    expect(result.current.items.map((item) => item.amount)).toEqual(["0.00", "-5.00"]);
  });

  it("aborts a superseded read and ignores its late result", async () => {
    const first = deferred();
    const second = deferred();
    activityTimelineApi.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useActivityTimeline());
    await waitFor(() => expect(activityTimelineApi.get).toHaveBeenCalledTimes(1));
    const firstSignal = activityTimelineApi.get.mock.calls[0][1];

    let refreshed;
    act(() => { refreshed = result.current.refresh(); });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => second.resolve(pageOf([row(5)])));
    await act(async () => first.resolve(pageOf([row(99)])));

    expect(await refreshed).toEqual({ stale: false, failed: false });
    expect(result.current.items.map((item) => item.recordId)).toEqual([5]);
  });

  it("ignores an old session read after an account switch", async () => {
    const old = deferred();
    const recent = deferred();
    activityTimelineApi.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
    const { result } = renderHook(() => useActivityTimeline());

    act(() => establishSession("session-b", "other@example.test"));
    await act(async () => recent.resolve(pageOf([row(7)])));
    await act(async () => old.resolve(pageOf([row(1), row(2)])));

    await waitFor(() => expect(result.current.items.map((item) => item.recordId)).toEqual([7]));
    expect(activityTimelineApi.get).toHaveBeenCalledTimes(2);
  });

  it("drops the rows when the session ends and issues no request without a session", async () => {
    const { result } = renderHook(() => useActivityTimeline());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => clearSession());

    await waitFor(() => expect(result.current.items).toEqual([]));
    expect(result.current.loading).toBe(false);
    expect(activityTimelineApi.get).toHaveBeenCalledTimes(1);
    expect(await act(async () => result.current.refresh())).toEqual({ stale: true });
    expect(activityTimelineApi.get).toHaveBeenCalledTimes(1);
  });

  it("issues no request while disabled, loads when enabled, and clears when disabled again", async () => {
    const { result, rerender } = renderHook(({ enabled }) => useActivityTimeline({ enabled }), {
      initialProps: { enabled: false },
    });
    expect(result.current).toMatchObject({ loading: false, items: [] });
    expect(await act(async () => result.current.refresh())).toEqual({ stale: true });
    expect(activityTimelineApi.get).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(activityTimelineApi.get).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.items).toEqual([]));
    expect(result.current.loading).toBe(false);
  });

  describe("filters", () => {
    const filterOf = (overrides = {}) => ({ q: "", kind: "", from: "", to: "", ...overrides });

    it("sends only the set filters on the first read", async () => {
      renderHook(() => useActivityTimeline({ filter: filterOf({ q: " coffee ", kind: "expense" }) }));

      await waitFor(() => expect(activityTimelineApi.get).toHaveBeenCalledTimes(1));
      expect(activityTimelineApi.get).toHaveBeenCalledWith(
        { limit: 25, q: "coffee", kind: "expense" }, expect.any(AbortSignal));
    });

    it("resets to a fresh first page and drops the old rows when the filter changes", async () => {
      activityTimelineApi.get
        .mockResolvedValueOnce(pageOf([row(1), row(2)], { hasMore: true, nextCursor: "cursor-1" }))
        .mockResolvedValueOnce(pageOf([row(7)]));
      const { result, rerender } = renderHook(({ filter }) => useActivityTimeline({ filter }), {
        initialProps: { filter: filterOf() },
      });
      await waitFor(() => expect(result.current.hasMore).toBe(true));

      rerender({ filter: filterOf({ q: "seven" }) });

      expect(result.current).toMatchObject({ items: [], hasMore: false, loading: true });
      await waitFor(() => expect(result.current.items.map((item) => item.recordId)).toEqual([7]));
      expect(activityTimelineApi.get).toHaveBeenLastCalledWith({ limit: 25, q: "seven" }, expect.any(AbortSignal));
      expect(result.current.appliedFilter).toEqual(filterOf({ q: "seven" }));
    });

    it("filter change then read failure shows no stale rows", async () => {
      activityTimelineApi.get
        .mockResolvedValueOnce(pageOf([row(1), row(2)], { hasMore: true, nextCursor: "cursor-1" }))
        .mockRejectedValueOnce(new Error("offline"));
      const { result, rerender } = renderHook(({ filter }) => useActivityTimeline({ filter }), {
        initialProps: { filter: filterOf() },
      });
      await waitFor(() => expect(result.current.items).toHaveLength(2));

      rerender({ filter: filterOf({ kind: "expense" }) });

      await waitFor(() => expect(result.current.error).toBe(true));
      expect(result.current).toMatchObject({ items: [], hasMore: false, refreshFailed: false, loading: false });
    });

    it("keeps same-filter rows on a failed refresh", async () => {
      const filter = filterOf({ q: "coffee" });
      const { result } = renderHook(() => useActivityTimeline({ filter }));
      await waitFor(() => expect(result.current.items).toHaveLength(2));
      activityTimelineApi.get.mockRejectedValueOnce(new Error("offline"));

      await act(async () => { await result.current.refresh(); });

      expect(result.current).toMatchObject({ refreshFailed: true, error: false });
      expect(result.current.items).toHaveLength(2);
    });

    it("loadMore after a filter change never sends the old cursor", async () => {
      const second = deferred();
      activityTimelineApi.get
        .mockResolvedValueOnce(pageOf([row(1), row(2)], { hasMore: true, nextCursor: "old-cursor" }))
        .mockReturnValueOnce(second.promise);
      const { result, rerender } = renderHook(({ filter }) => useActivityTimeline({ filter }), {
        initialProps: { filter: filterOf() },
      });
      await waitFor(() => expect(result.current.hasMore).toBe(true));
      const staleLoadMore = result.current.loadMore;

      rerender({ filter: filterOf({ q: "new" }) });
      const outcome = await act(async () => staleLoadMore());

      expect(outcome).toEqual({ stale: true });
      expect(activityTimelineApi.get.mock.calls.every(([params]) => params.cursor !== "old-cursor")).toBe(true);
      await act(async () => second.resolve(pageOf([row(9)], { hasMore: true, nextCursor: "new-cursor" })));
      await act(async () => { await result.current.loadMore(); });
      expect(activityTimelineApi.get).toHaveBeenLastCalledWith(
        { limit: 25, cursor: "new-cursor", q: "new" }, expect.any(AbortSignal));
    });

    it("drops a late response read under the previous filter", async () => {
      const first = deferred();
      const second = deferred();
      activityTimelineApi.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result, rerender } = renderHook(({ filter }) => useActivityTimeline({ filter }), {
        initialProps: { filter: filterOf() },
      });
      await waitFor(() => expect(activityTimelineApi.get).toHaveBeenCalledTimes(1));

      rerender({ filter: filterOf({ q: "b" }) });
      await act(async () => second.resolve(pageOf([row(5)])));
      await act(async () => first.resolve(pageOf([row(99)])));

      expect(result.current.items.map((item) => item.recordId)).toEqual([5]);
    });

    it("issues no request for a filter change while disabled", async () => {
      const { rerender } = renderHook(({ filter }) => useActivityTimeline({ enabled: false, filter }), {
        initialProps: { filter: filterOf() },
      });

      rerender({ filter: filterOf({ q: "x" }) });

      expect(activityTimelineApi.get).not.toHaveBeenCalled();
    });

    it("carries the filter on loadMore and refresh", async () => {
      const filter = filterOf({ q: "coffee", from: "2026-09-01" });
      activityTimelineApi.get
        .mockResolvedValueOnce(pageOf([row(1)], { hasMore: true, nextCursor: "c1" }))
        .mockResolvedValueOnce(pageOf([row(2)]))
        .mockResolvedValueOnce(pageOf([row(1)]));
      const { result } = renderHook(() => useActivityTimeline({ filter }));
      await waitFor(() => expect(result.current.hasMore).toBe(true));

      await act(async () => { await result.current.loadMore(); });
      expect(activityTimelineApi.get).toHaveBeenLastCalledWith(
        { limit: 25, cursor: "c1", q: "coffee", from: "2026-09-01" }, expect.any(AbortSignal));
      await act(async () => { await result.current.refresh(); });
      expect(activityTimelineApi.get).toHaveBeenLastCalledWith(
        { limit: 25, q: "coffee", from: "2026-09-01" }, expect.any(AbortSignal));
    });
  });
});
