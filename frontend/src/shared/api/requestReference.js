// Support reference for server errors (#340). The backend sends a random request ID in the
// X-Request-Id header and in the `requestId` field of problem bodies. On a 5xx we keep only the
// latest ID in memory (never stored, never logged) so the person can quote it to support.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const listeners = new Set();
let latest = null;

// Returns the ID if it is a safe, plain token; anything else is ignored.
export function parseRequestId(value) {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value) ? value : null;
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  return typeof headers.get === "function" ? headers.get(name) : headers[name];
}

function publish(next) {
  if (next === latest) return;
  latest = next;
  listeners.forEach((listener) => listener());
}

// Reads the ID from a failed response (axios shape or fetch Response headers) and keeps it for a
// status of 500 or more. Body field first, then the header; no valid ID means no notice.
export function reportServerError({ status, data, headers } = {}) {
  if (typeof status !== "number" || status < 500) return;
  const id = parseRequestId(data && typeof data === "object" ? data.requestId : undefined)
    ?? parseRequestId(headerValue(headers, "x-request-id"));
  if (id) publish(id);
}

export function getRequestReference() {
  return latest;
}

export function clearRequestReference() {
  publish(null);
}

export function subscribeToRequestReference(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
