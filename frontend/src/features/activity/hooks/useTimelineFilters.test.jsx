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

  it("fills from/to at once for a preset and does not add period to the filter", () => {
    vi.setSystemTime(new Date(2026, 8, 15, 12));
    const { result } = renderHook(() => useTimelineFilters());

    act(() => result.current.setPeriod("last7"));
    act(() => { vi.advanceTimersByTime(0); });

    expect(result.current.period).toBe("last7");
    expect(result.current.applied).toEqual({ q: "", kind: "", from: "2026-09-09", to: "2026-09-15" });
    expect(Object.keys(result.current.applied)).toEqual(["q", "kind", "from", "to"]);
  });

  it("switches to custom when a date is typed and keeps the typed dates", () => {
    const { result } = renderHook(() => useTimelineFilters());
    act(() => result.current.setField("from", "2026-09-01"));
    expect(result.current.period).toBe("custom");
    act(() => result.current.setPeriod("custom"));
    expect(result.current.draft.from).toBe("2026-09-01");
  });

  it("removes an applied field at once, bypassing the search debounce", () => {
    const { result } = renderHook(() => useTimelineFilters());
    act(() => result.current.setField("q", "coffee"));
    act(() => { vi.advanceTimersByTime(300); });
    act(() => result.current.setField("kind", "expense"));
    act(() => { vi.advanceTimersByTime(0); });

    act(() => result.current.removeField("q"));

    expect(result.current.applied).toMatchObject({ q: "", kind: "expense" });
    expect(result.current.draft.q).toBe("");
  });

  it("removes a period or a single custom date from applied even with an invalid draft", () => {
    vi.setSystemTime(new Date(2026, 8, 15, 12));
    const { result } = renderHook(() => useTimelineFilters());
    act(() => result.current.setPeriod("thisMonth"));
    act(() => { vi.advanceTimersByTime(0); });
    act(() => result.current.setField("to", "2026-08-01"));
    expect(result.current.error).toBe("range");

    act(() => result.current.removeField("to"));
    expect(result.current.applied).toMatchObject({ from: "2026-09-01", to: "" });
    expect(result.current.period).toBe("custom");

    act(() => result.current.removeField("period"));
    expect(result.current.applied).toMatchObject({ from: "", to: "" });
    expect(result.current.period).toBe("all");
  });

  it("resets the period on clear", () => {
    const { result } = renderHook(() => useTimelineFilters());
    act(() => result.current.setPeriod("last30"));
    act(() => result.current.clear());
    expect(result.current.period).toBe("all");
  });
});
