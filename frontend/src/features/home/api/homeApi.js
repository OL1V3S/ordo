import client from "../../../shared/api/client";

export const homeApi = {
  getHome: (activityThroughDate, signal) => client.get("/api/home", {
    params: { activityThroughDate },
    signal,
  }),
};
