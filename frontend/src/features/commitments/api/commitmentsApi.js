import client from "../../../shared/api/client";

export const commitmentsApi = {
  getCandidates: () => client.get("/api/commitment-candidates"),
  dismissCandidate: (fingerprint) => client.post("/api/commitment-candidates/dismiss", { fingerprint }),
  reconsiderCandidate: (fingerprint) => client.post("/api/commitment-candidates/reconsider", { fingerprint }),
  confirmCandidate: (payload) => client.post("/api/commitment-candidates/confirm", payload),
  getCommitments: () => client.get("/api/commitments"),
  getChanges: () => client.get("/api/commitment-changes"),
  acceptAmountChange: (id, fingerprint) =>
    client.post(`/api/commitment-changes/${id}/amount/accept`, { fingerprint }),
  acceptTimingChange: (id, fingerprint) =>
    client.post(`/api/commitment-changes/${id}/timing/accept`, { fingerprint }),
  markEndedFromChange: (id, fingerprint) =>
    client.post(`/api/commitment-changes/${id}/missing/mark-ended`, { fingerprint }),
  keepChange: (id, dimension, fingerprint) =>
    client.post(`/api/commitment-changes/${id}/${dimension}/keep`, { fingerprint }),
  reconsiderChange: (id, dimension, fingerprint) =>
    client.post(`/api/commitment-changes/${id}/${dimension}/reconsider`, { fingerprint }),
  updateCommitment: (id, payload) => client.put(`/api/commitments/${id}`, payload),
  updateLifecycle: (id, lifecycle) => client.patch(`/api/commitments/${id}/lifecycle`, { lifecycle }),
};
