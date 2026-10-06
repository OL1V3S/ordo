import client from "../../../shared/api/client";

const FILTER_KEYS = ["q", "kind", "from", "to"];

// Only set filters are sent; the owner is never a parameter.
export const activityTimelineApi = {
  get: ({ limit, cursor, q, kind, from, to } = {}, signal) => {
    const filters = { q: typeof q === "string" ? q.trim() : q, kind, from, to };
    return client.get("/api/activity/timeline", {
      params: {
        limit,
        ...(cursor ? { cursor } : {}),
        ...Object.fromEntries(FILTER_KEYS.filter((key) => filters[key]).map((key) => [key, filters[key]])),
      },
      signal,
    });
  },
};
