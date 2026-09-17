import client from "../../../shared/api/client";

export const paychecksApi = {
  getCandidates: () => client.get("/api/paycheck-candidates"),
  getPaychecks: () => client.get("/api/paychecks"),
  getPaycheck: (id) => client.get(`/api/paychecks/${id}`),
  confirmCandidate: (payload) => client.post("/api/paycheck-candidates/confirm", payload),
  dismissCandidate: (tuple) => client.post("/api/paycheck-candidates/dismiss", tuple),
  reconsiderCandidate: (tuple) => client.post("/api/paycheck-candidates/reconsider", tuple),
  createPaycheck: (payload) => client.post("/api/paychecks", payload),
  updatePaycheck: (id, payload) => client.put(`/api/paychecks/${id}`, payload),
  updateLifecycle: (id, lifecycle) => client.patch(`/api/paychecks/${id}/lifecycle`, { lifecycle }),
  recordReceipt: (id, payload) => client.post(`/api/paychecks/${id}/receipts`, payload),
  removeReceipt: (id, accountInflowId) => client.delete(`/api/paychecks/${id}/receipts/${accountInflowId}`),
};
