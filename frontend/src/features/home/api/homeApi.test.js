import { describe, expect, it, vi } from "vitest";
import client from "../../../shared/api/client";
import { homeApi } from "./homeApi";

vi.mock("../../../shared/api/client", () => ({ default: { get: vi.fn() } }));

describe("homeApi", () => {
  it("passes the local calendar cutoff and abort signal to the Home endpoint", () => {
    const signal = new AbortController().signal;

    homeApi.getHome("2026-09-23", signal);

    expect(client.get).toHaveBeenCalledWith("/api/home", {
      params: { activityThroughDate: "2026-09-23" },
      signal,
    });
  });
});
