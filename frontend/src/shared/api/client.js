import axios from "axios";
import { getAccessToken, getSessionSnapshot, invalidateSession } from "../auth/session";

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
  (error) => {
    const request = requestSessions.get(error.config);
    requestSessions.delete(error.config);
    if (error.response?.status === 401 && request) invalidateSession(request.session, request.token);
    return Promise.reject(error);
  },
);

export default client;
