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
});
