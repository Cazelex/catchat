// End-to-end encryption for CatChat.
// The room code is the secret. It never leaves the browser.
// From it we make two unrelated things:
//   1. a room ID (a SHA-256 fingerprint) that the server uses to group people
//   2. an AES-256 key that encrypts every message
// The fingerprint can't be turned back into the code, so the server can't make the key.

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// 1. Room ID: what the server sees instead of the real code
async function roomIdFor(code) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode("catchat-room-id:" + code)));
}

// 2. Encryption key: PBKDF2 runs SHA-256 200,000 times, so guessing codes is very slow
async function keyFor(code) {
  const base = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("catchat-key-v1"), iterations: 200000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt: a new random IV every time, so the same message never looks the same twice
async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return { iv: toB64(iv), ct: toB64(ct) };
}

// Decrypt: AES-GCM also detects tampering, so a changed message throws an error
async function decryptText(key, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ct));
  return dec.decode(pt);
}

// Files: same AES-GCM key, but working on raw bytes instead of text
async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: toB64(iv), ct }; // ct stays binary (ArrayBuffer), Socket.IO sends it as-is
}

async function decryptBytes(key, iv, ct) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, ct);
}
