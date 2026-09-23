import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, establishSession } from "../../../shared/auth/session";
import { homeApi } from "../api/homeApi";
import { useHomeData } from "./useHomeData";

vi.mock("../api/homeApi", () => ({ homeApi: { getHome: vi.fn() } }));

const validHome = {
  generatedAt: "2026-09-23T12:00:00Z",
  currencyCode: "USD",
  evaluations: { activityThroughDate: "2026-09-23", upcomingEvaluatedOn: "2026-09-23" },
  attention: { availability: { state: "available", reasonCode: null }, kindsEvaluated: [], items: [] },
  recentActivity: { availability: { state: "available", reasonCode: null }, items: [] },
  upcoming: { availability: { state: "available", reasonCode: null }, horizon: { from: "2026-09-23", through: "2026-10-06" }, items: [] },
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("useHomeData", () => {
  beforeEach(() => {
    establishSession("session-a", "home@example.test");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 23, 12, 0, 0));
    vi.clearAllMocks();
    homeApi.getHome.mockResolvedValue({ data: validHome });
  });

  afterEach(() => {
    clearSession();
    vi.useRealTimers();
  });

  it("loads the Home contract with a local-calendar cutoff and exposes an awaitable refresh", async () => {
    const { result } = renderHook(() => useHomeData());
    await waitFor(() => expect(result.current.data).toEqual(validHome));
    expect(homeApi.getHome).toHaveBeenCalledWith("2026-09-23", expect.any(AbortSignal));

    const refreshed = await act(async () => result.current.refresh());
    expect(refreshed).toMatchObject({ stale: false, failed: false, data: validHome });
  });

  it("reports failed reads without preserving stale Home data", async () => {
    const { result } = renderHook(() => useHomeData());
    await waitFor(() => expect(result.current.data).toEqual(validHome));
    homeApi.getHome.mockRejectedValueOnce(new Error("offline"));

    const refreshed = await act(async () => result.current.refresh());

    expect(refreshed).toMatchObject({ stale: false, failed: true });
    expect(result.current).toMatchObject({ data: null, loading: false, error: true });
  });

  it("ignores an old session read after an account switch", async () => {
    const old = deferred();
    const recent = deferred();
    homeApi.getHome.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
    const { result } = renderHook(() => useHomeData());

    act(() => establishSession("session-b", "other@example.test"));
    await act(async () => recent.resolve({ data: validHome }));
    await act(async () => old.resolve({ data: { ...validHome, generatedAt: "2026-01-01T00:00:00Z" } }));

    await waitFor(() => expect(result.current.data).toEqual(validHome));
    expect(homeApi.getHome).toHaveBeenCalledTimes(2);
  });
});
