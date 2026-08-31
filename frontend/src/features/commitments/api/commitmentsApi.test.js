import { beforeEach, describe, expect, it, vi } from "vitest";
import client from "../../../shared/api/client";
import { commitmentsApi } from "./commitmentsApi";

vi.mock("../../../shared/api/client", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
}));

describe("commitment API contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.get.mockResolvedValue({ data: [] });
    client.post.mockResolvedValue({ data: {} });
    client.put.mockResolvedValue({ data: {} });
    client.patch.mockResolvedValue({ data: {} });
  });

  it("uses the candidate review endpoints with opaque fingerprints", async () => {
    await commitmentsApi.getCandidates();
    await commitmentsApi.dismissCandidate("abc");
    await commitmentsApi.reconsiderCandidate("def");
    await commitmentsApi.confirmCandidate({ fingerprint: "ghi", name: "Rent" });

    expect(client.get).toHaveBeenCalledWith("/api/commitment-candidates");
    expect(client.post).toHaveBeenNthCalledWith(1, "/api/commitment-candidates/dismiss", { fingerprint: "abc" });
    expect(client.post).toHaveBeenNthCalledWith(2, "/api/commitment-candidates/reconsider", { fingerprint: "def" });
    expect(client.post).toHaveBeenNthCalledWith(3, "/api/commitment-candidates/confirm", { fingerprint: "ghi", name: "Rent" });
  });

  it("uses the confirmed commitment and lifecycle endpoints", async () => {
    const payload = { name: "Updated rent" };
    await commitmentsApi.getCommitments();
    await commitmentsApi.updateCommitment("commitment-1", payload);
    await commitmentsApi.updateLifecycle("commitment-1", "paused");

    expect(client.get).toHaveBeenCalledWith("/api/commitments");
    expect(client.put).toHaveBeenCalledWith("/api/commitments/commitment-1", payload);
    expect(client.patch).toHaveBeenCalledWith("/api/commitments/commitment-1/lifecycle", { lifecycle: "paused" });
  });

  it("uses exact-fingerprint commitment change endpoints without client-authored proposals", async () => {
    await commitmentsApi.getChanges();
    await commitmentsApi.acceptAmountChange("commitment-1", "amount-fingerprint");
    await commitmentsApi.acceptTimingChange("commitment-1", "timing-fingerprint");
    await commitmentsApi.markEndedFromChange("commitment-1", "missing-fingerprint");
    await commitmentsApi.keepChange("commitment-1", "amount", "amount-fingerprint");
    await commitmentsApi.reconsiderChange("commitment-1", "missing", "missing-fingerprint");

    expect(client.get).toHaveBeenCalledWith("/api/commitment-changes");
    expect(client.post).toHaveBeenNthCalledWith(
      1,
      "/api/commitment-changes/commitment-1/amount/accept",
      { fingerprint: "amount-fingerprint" }
    );
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      "/api/commitment-changes/commitment-1/timing/accept",
      { fingerprint: "timing-fingerprint" }
    );
    expect(client.post).toHaveBeenNthCalledWith(
      3,
      "/api/commitment-changes/commitment-1/missing/mark-ended",
      { fingerprint: "missing-fingerprint" }
    );
    expect(client.post).toHaveBeenNthCalledWith(
      4,
      "/api/commitment-changes/commitment-1/amount/keep",
      { fingerprint: "amount-fingerprint" }
    );
    expect(client.post).toHaveBeenNthCalledWith(
      5,
      "/api/commitment-changes/commitment-1/missing/reconsider",
      { fingerprint: "missing-fingerprint" }
    );
  });
});
