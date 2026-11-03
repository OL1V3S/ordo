// Web session state (#337). The access token lives only in this tab's memory:
// never in localStorage or sessionStorage, so it is not readable from storage.
// The HttpOnly cookie is the only durable credential; every page load gets a new
// token by refreshing through it (webSession.js). Non-secret identity (the random
// session id and the email) is mirrored to localStorage so other tabs, capture
// recovery and the stale-401 guard can see which sign-in this is.
import { clearRequestReference } from "../api/requestReference";

let snapshot;
let generation = 0;
let accessToken = null;
// The sign-in identity the in-memory token belongs to, and whether it could be
// mirrored to storage (when it could not, storage cannot be compared against).
let currentId = null;
let identityMirrored = false;
// The generation the support request reference (#340) belongs to. When a snapshot
// read finds a newer one (another tab changed the session), handleStorage clears
// the reference. It is never cleared inside getSessionSnapshot: React reads that
// during render.
let referenceGeneration = 0;
const listeners = new Set();

const ID_KEY = "sessionId";
const EMAIL_KEY = "email";
// Written by versions before #337 that kept the access token in storage.
const LEGACY_TOKEN_KEY = "token";

// Identity is a random, non-secret id minted per sign-in. The access token is
// not part of identity, so a token refresh keeps the same snapshot.
function newSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStored(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing durable to remove.
  }
}

export function getAccessToken() {
  return accessToken;
}

// The identity another load (or another tab) left in storage; null when none.
export function getStoredSessionId() {
  return readStored(ID_KEY);
}

export function hasStoredIdentity() {
  return Boolean(readStored(ID_KEY));
}

// Delete the pre-#337 token key. Called on boot; the value is never read.
export function removeLegacyAccessToken() {
  removeStored(LEGACY_TOKEN_KEY);
}

// Another tab signed in (new id) or signed out (no id): the token held here
// belongs to a session that tab ended, so drop it without touching storage.
function reconcileStoredIdentity() {
  if (!accessToken || !identityMirrored) return;
  if (readStored(ID_KEY) === currentId) return;

  accessToken = null;
  currentId = null;
  identityMirrored = false;
}

export function getSessionSnapshot() {
  reconcileStoredIdentity();

  const email = readStored(EMAIL_KEY);
  const id = accessToken ? currentId : null;

  if (snapshot && id !== snapshot.id) generation += 1;

  const signedIn = Boolean(accessToken);
  if (!snapshot || signedIn !== snapshot.signedIn || id !== snapshot.id || email !== snapshot.email || generation !== snapshot.generation) {
    snapshot = Object.freeze({ signedIn, id, email, generation });
  }

  return snapshot;
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function handleStorage(event) {
  // The legacy "token" key is ignored on purpose: it is never a credential here.
  if (event.storageArea !== localStorage || ![null, ID_KEY, EMAIL_KEY].includes(event.key)) return;

  // Read the latest values: a queued event may describe an older session.
  getSessionSnapshot();
  // Another tab signed in or out: a support reference raised in the old session
  // must not outlive it. Done here, not in getSessionSnapshot (called in render).
  if (generation !== referenceGeneration) {
    clearRequestReference();
    referenceGeneration = generation;
  }
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

function publishSignedIn(token, id) {
  accessToken = token;
  currentId = id;
  generation += 1;
  snapshot = Object.freeze({ signedIn: Boolean(accessToken), id, email: readStored(EMAIL_KEY), generation });
  // A support reference belongs to the sign-in it was raised in (#340).
  clearRequestReference();
  referenceGeneration = generation;
  notifyListeners();
}

// A new sign-in: mint an identity, mirror it, hold the token in memory.
export function establishSession(token, email) {
  getSessionSnapshot();
  const id = newSessionId();
  identityMirrored = writeStored(ID_KEY, id);
  writeStored(EMAIL_KEY, email);
  removeLegacyAccessToken();
  publishSignedIn(token, id);
}

// A token obtained by refreshing through the cookie when this tab holds none
// (page load, or after another tab signed in). When an identity is stored it is
// adopted as is, with no storage write, so other tabs are not disturbed. With no
// stored identity (the cookie outlived storage) a new one is established.
export function adoptAccessToken(token, email) {
  const stored = readStored(ID_KEY);
  if (!stored) {
    establishSession(token, email);
    return;
  }

  getSessionSnapshot();
  if (email && readStored(EMAIL_KEY) !== email) writeStored(EMAIL_KEY, email);
  identityMirrored = true;
  publishAdopted(token, stored);
}

function publishAdopted(token, id) {
  accessToken = token;
  currentId = id;
  getSessionSnapshot();
  // An adopt can run before the storage event of the sign-in it follows: a
  // support reference from the older session must not carry over (#340).
  if (generation !== referenceGeneration) clearRequestReference();
  referenceGeneration = generation;
  notifyListeners();
}

// A refreshed access token for the current sign-in: identity and generation stay
// the same, so snapshots, hooks and capture recovery do not see a new session.
// Nothing is written for the token; the email is written only if it changed.
export function replaceAccessToken(token, email) {
  accessToken = token;
  if (email && readStored(EMAIL_KEY) !== email) writeStored(EMAIL_KEY, email);
  getSessionSnapshot();
  notifyListeners();
}

// Re-read storage and notify, e.g. after another tab signed out.
export function syncSessionFromStorage() {
  getSessionSnapshot();
  notifyListeners();
}

export function clearSession() {
  getSessionSnapshot();
  accessToken = null;
  currentId = null;
  identityMirrored = false;
  removeStored(ID_KEY);
  removeStored(EMAIL_KEY);
  removeLegacyAccessToken();
  generation += 1;
  snapshot = Object.freeze({ signedIn: false, id: null, email: null, generation });
  clearRequestReference();
  referenceGeneration = generation;
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
