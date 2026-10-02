import client from "../../../shared/api/client";

export const activityTimelineApi = {
  get: ({ limit, cursor } = {}, signal) => client.get("/api/activity/timeline", {
    params: { limit, ...(cursor ? { cursor } : {}) },
    signal,
  }),
};
