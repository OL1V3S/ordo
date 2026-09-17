import { beforeEach, describe, expect, it, vi } from "vitest";
import client from "../../../shared/api/client";
import { paychecksApi } from "./paychecksApi";

vi.mock("../../../shared/api/client", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const schedule = {
  cadence: "semimonthly", referenceAnchorDate: null,
  firstMonthAnchor: { kind: "day_of_month", day: 15 },
  secondMonthAnchor: { kind: "month_end", day: null },
};
const expectation = {
  displayName: "Synthetic payroll", windowBeforeDays: 1, windowAfterDays: 2,
  amount: { mode: "range", fixedAmount: null, minimumAmount: "900.01", maximumAmount: "1300.25" },
};

describe("paycheck API contracts", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads candidate lists, profile lists and an individual profile through the shared client", async () => {
    const response = { data: { paychecks: [] } };
    client.get.mockResolvedValue(response);
    await paychecksApi.getCandidates();
    await paychecksApi.getPaychecks();
    expect(await paychecksApi.getPaycheck("profile-id")).toBe(response);
    expect(client.get.mock.calls).toEqual([
      ["/api/paycheck-candidates"], ["/api/paychecks"], ["/api/paychecks/profile-id"],
    ]);
  });

  it("sends the exact candidate acceptance schedule and explicit accepted values unchanged", async () => {
    const payload = { ...expectation, schedule, algorithmVersion: "paycheck-candidate-v1", fingerprint: "a".repeat(64) };
    const response = { status: 200, data: { paycheck: { id: "existing" }, alreadyConfirmed: true } };
    client.post.mockResolvedValue(response);
    expect(await paychecksApi.confirmCandidate(payload)).toBe(response);
    expect(client.post).toHaveBeenCalledWith("/api/paycheck-candidates/confirm", payload);
    expect(client.post.mock.calls[0][1]).toBe(payload);
  });

  it("uses complete version/cadence/fingerprint tuples for both candidate decisions", async () => {
    const tuple = { algorithmVersion: "paycheck-candidate-v1", cadence: "semimonthly", fingerprint: "b".repeat(64) };
    await paychecksApi.dismissCandidate(tuple);
    await paychecksApi.reconsiderCandidate(tuple);
    expect(client.post.mock.calls).toEqual([
      ["/api/paycheck-candidates/dismiss", tuple], ["/api/paycheck-candidates/reconsider", tuple],
    ]);
  });

  it("creates complete manual profiles and updates only the supplied mutable expectation", async () => {
    const manual = { ...expectation, schedule };
    await paychecksApi.createPaycheck(manual);
    await paychecksApi.updatePaycheck("profile-id", expectation);
    expect(client.post).toHaveBeenCalledWith("/api/paychecks", manual);
    expect(client.put).toHaveBeenCalledWith("/api/paychecks/profile-id", expectation);
    expect(Object.keys(client.post.mock.calls[0][1]).sort()).toEqual(["amount", "displayName", "schedule", "windowAfterDays", "windowBeforeDays"]);
    expect(Object.keys(client.put.mock.calls[0][1]).sort()).toEqual(["amount", "displayName", "windowAfterDays", "windowBeforeDays"]);
  });

  it.each(["active", "paused", "ended"])("patches the explicit %s lifecycle without other profile fields", async (lifecycle) => {
    await paychecksApi.updateLifecycle("profile-id", lifecycle);
    expect(client.patch).toHaveBeenCalledWith("/api/paychecks/profile-id/lifecycle", { lifecycle });
  });

  it("records and removes receipt links through profile-scoped routes", async () => {
    const payload = { slotAnchor: "2026-09-10", existingInflowId: 42 };
    await paychecksApi.recordReceipt("profile-id", payload);
    await paychecksApi.removeReceipt("profile-id", 42);
    expect(client.post).toHaveBeenCalledWith("/api/paychecks/profile-id/receipts", payload);
    expect(client.delete).toHaveBeenCalledWith("/api/paychecks/profile-id/receipts/42");
  });

  it("passes write failures to the caller without automatically retrying", async () => {
    const error = new Error("synthetic connection failure");
    client.post.mockRejectedValue(error);
    await expect(paychecksApi.createPaycheck({ ...expectation, schedule })).rejects.toBe(error);
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(paychecksApi).not.toHaveProperty("deletePaycheck");
  });
});
