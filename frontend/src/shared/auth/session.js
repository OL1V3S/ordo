let snapshot;
let generation = 0;
const listeners = new Set();

// Identity is a random, non-secret id minted per sign-in. The access token is
// not part of identity, so a future token refresh keeps the same snapshot.
function newSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getAccessToken() {
  return localStorage.getItem("token");
}

export function getSessionSnapshot() {
  const token = getAccessToken();
  const email = localStorage.getItem("email");
  let id = localStorage.getItem("sessionId");

  if (!token) id = null;
  else if (!id) {
    // Sign-in from before session ids existed: mint one so the session is stable.
    id = newSessionId();
    localStorage.setItem("sessionId", id);
  }

  if (snapshot && id !== snapshot.id) generation += 1;

  const signedIn = Boolean(token);
  if (!snapshot || signedIn !== snapshot.signedIn || id !== snapshot.id || email !== snapshot.email || generation !== snapshot.generation) {
    snapshot = Object.freeze({ signedIn, id, email, generation });
  }

  return snapshot;
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function handleStorage(event) {
  if (event.storageArea !== localStorage || ![null, "token", "email", "sessionId"].includes(event.key)) return;

  // Read the latest values: a queued event may describe an older session.
  getSessionSnapshot();
  notifyListeners();
}

export function subscribeToSession(listener) {
  if (listeners.size === 0) window.addEventListener("storage", handleStorage);
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", handleStorage);
  };
}

export function establishSession(token, email) {
  getSessionSnapshot();
  const id = newSessionId();
  localStorage.setItem("token", token);
  localStorage.setItem("email", email);
  localStorage.setItem("sessionId", id);
  generation += 1;
  snapshot = Object.freeze({ signedIn: Boolean(localStorage.getItem("token")), id, email: localStorage.getItem("email"), generation });
  notifyListeners();
}

export function clearSession() {
  getSessionSnapshot();
  localStorage.removeItem("token");
  localStorage.removeItem("email");
  localStorage.removeItem("sessionId");
  generation += 1;
  snapshot = Object.freeze({ signedIn: false, id: null, email: null, generation });
  notifyListeners();
}

// A request clears the session only if it used the current token of the current
// sign-in, so a stale 401 cannot sign out a newer token or sign-in.
export function invalidateSession(requestSession, requestToken) {
  const current = getSessionSnapshot();
  if (!requestSession?.signedIn || !requestToken || requestToken !== getAccessToken() || requestSession.generation !== current.generation) return false;

  clearSession();
  return true;
}
