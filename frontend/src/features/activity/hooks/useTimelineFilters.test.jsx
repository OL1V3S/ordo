import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineFilters } from "./useTimelineFilters";

describe("useTimelineFilters", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces the search and applies it once it settles", () => {
    const { result } = renderHook(() => useTimelineFilters());

    act(() => result.current.setField("q", "co"));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.setField("q", "cof"));
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current.applied.q).toBe("");

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.applied.q).toBe("cof");
  });

  it("applies kind and dates at once", () => {
    const { result } = renderHook(() => useTimelineFilters());

    act(() => result.current.setField("kind", "expense"));
    act(() => { vi.advanceTimersByTime(0); });

    expect(result.current.applied.kind).toBe("expense");
  });

  it("never applies an invalid draft and keeps the last valid filter", () => {
    const { result } = renderHook(() => useTimelineFilters());
    act(() => result.current.setField("from", "2026-09-01"));
    act(() => { vi.advanceTimersByTime(0); });

    act(() => result.current.setField("to", "2026-08-01"));
    act(() => { vi.advanceTimersByTime(1000); });

    expect(result.current.error).toBe("range");
    expect(result.current.applied).toMatchObject({ from: "2026-09-01", to: "" });

    act(() => result.current.setField("to", "2026-09-30"));
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.error).toBeNull();
    expect(result.current.applied.to).toBe("2026-09-30");
  });

  it("clears the draft and the applied filter immediately", () => {
    const { result } = renderHook(() => useTimelineFilters());
    act(() => result.current.setField("kind", "expense"));
    act(() => { vi.advanceTimersByTime(0); });

    act(() => result.current.clear());

    expect(result.current.draft).toMatchObject({ q: "", kind: "", from: "", to: "" });
    expect(result.current.applied).toMatchObject({ q: "", kind: "", from: "", to: "" });
    expect(result.current.active).toBe(false);
  });
});
