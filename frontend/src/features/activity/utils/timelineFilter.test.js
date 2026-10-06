import { describe, expect, it } from "vitest";
import {
  EMPTY_TIMELINE_FILTER,
  isTimelineFilterActive,
  timelineFilterKey,
  timelineFilterParams,
  validateTimelineFilter,
} from "./timelineFilter";

describe("timeline filter helpers", () => {
  it("treats a blank or empty filter as inactive and builds no parameters", () => {
    expect(isTimelineFilterActive(EMPTY_TIMELINE_FILTER)).toBe(false);
    expect(isTimelineFilterActive({ q: "   " })).toBe(false);
    expect(timelineFilterParams({ q: "  ", kind: "", from: "", to: "" })).toEqual({});
    expect(timelineFilterKey({ q: " a " })).toBe(timelineFilterKey({ q: "a", kind: "" }));
  });

  it("builds parameters only for the set filters", () => {
    expect(timelineFilterParams({ q: " x ", kind: "account_inflow", from: "2026-09-01", to: "" }))
      .toEqual({ q: "x", kind: "account_inflow", from: "2026-09-01" });
  });

  it.each([
    [{ q: "a".repeat(100) }, null],
    [{ q: ` ${"a".repeat(100)} ` }, null],
    [{ q: "a".repeat(101) }, "search"],
    [{ kind: "income" }, "kind"],
    [{ from: "2026-9-1" }, "date"],
    [{ to: "2026-02-30" }, "date"],
    [{ from: "2026-09-02", to: "2026-09-01" }, "range"],
    [{ from: "2026-09-01", to: "2026-09-01" }, null],
    [{ from: "2026-09-01" }, null],
  ])("validates %j as %s", (filter, expected) => {
    expect(validateTimelineFilter(filter)).toBe(expected);
  });
});
