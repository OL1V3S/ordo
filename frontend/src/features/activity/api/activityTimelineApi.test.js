import { describe, expect, it, vi } from "vitest";
import client from "../../../shared/api/client";
import { activityTimelineApi } from "./activityTimelineApi";

vi.mock("../../../shared/api/client", () => ({ default: { get: vi.fn() } }));

describe("activityTimelineApi", () => {
  it("requests the first page with only a limit and the abort signal", () => {
    const signal = new AbortController().signal;

    activityTimelineApi.get({ limit: 25 }, signal);

    expect(client.get).toHaveBeenCalledWith("/api/activity/timeline", { params: { limit: 25 }, signal });
  });

  it("sends the opaque cursor unchanged for later pages and never an owner", () => {
    const signal = new AbortController().signal;

    activityTimelineApi.get({ limit: 25, cursor: "opaque-cursor_1" }, signal);

    expect(client.get).toHaveBeenLastCalledWith("/api/activity/timeline", {
      params: { limit: 25, cursor: "opaque-cursor_1" },
      signal,
    });
  });
});
