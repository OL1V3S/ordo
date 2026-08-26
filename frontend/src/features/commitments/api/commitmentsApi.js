import client from "../../../shared/api/client";

export const commitmentsApi = {
  getCandidates: () => client.get("/api/commitment-candidates"),
  dismissCandidate: (fingerprint) => client.post("/api/commitment-candidates/dismiss", { fingerprint }),
  reconsiderCandidate: (fingerprint) => client.post("/api/commitment-candidates/reconsider", { fingerprint }),
  confirmCandidate: (payload) => client.post("/api/commitment-candidates/confirm", payload),
  getCommitments: () => client.get("/api/commitments"),
  updateCommitment: (id, payload) => client.put(`/api/commitments/${id}`, payload),
  updateLifecycle: (id, lifecycle) => client.patch(`/api/commitments/${id}/lifecycle`, { lifecycle }),
};
