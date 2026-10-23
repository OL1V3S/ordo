import axios from "axios";
import { getAccessToken, getSessionSnapshot, invalidateSession } from "../auth/session";
import { refreshWebSession } from "../auth/webSession";

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
});

const requestSessions = new WeakMap();

client.interceptors.request.use((config) => {
  const session = getSessionSnapshot();
  const token = getAccessToken();

  if (session.signedIn && token) {
    config.headers.Authorization = `Bearer ${token}`;
    if (!config.skipSessionInvalidation) requestSessions.set(config, { session, token });
  }

  return config;
});

client.interceptors.response.use(
  (response) => {
    requestSessions.delete(response.config);
    return response;
  },
  async (error) => {
    const request = requestSessions.get(error.config);
    requestSessions.delete(error.config);
    if (error.response?.status !== 401 || !request) return Promise.reject(error);

    // One shared web-session refresh, then retry once with the new token of the
    // same sign-in. A 401 rejects the request before it runs, so a retry is safe.
    // A 401 from an earlier sign-in never refreshes the current one.
    const latest = getSessionSnapshot();
    if (!error.config.webSessionRetried && latest.id === request.session.id && latest.generation === request.session.generation) {
      const refreshed = await refreshWebSession({ triggerToken: request.token, reason: "unauthorized" });
      const current = getSessionSnapshot();
      const token = getAccessToken();
      if (refreshed && token && token !== request.token
        && current.id === request.session.id && current.generation === request.session.generation) {
        return client.request({ ...error.config, webSessionRetried: true });
      }
    }

    invalidateSession(request.session, request.token);
    return Promise.reject(error);
  },
);

export default client;
