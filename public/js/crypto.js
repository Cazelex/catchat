// End-to-end encryption using the browser's built-in Web Crypto API.
// The password never leaves the browser; the server only ever sees scrambled data.

const enc = new TextEncoder();
const dec = new TextDecoder();

// base64 helpers (encrypted data is raw bytes, base64 makes it safe to send)
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

// Turn "room code + password" into a 256-bit AES key.
// PBKDF2 runs SHA-256 200,000 times, which makes guessing passwords very slow.
async function deriveKey(password, room) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("catchat:" + room), iterations: 200000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypt a message. A fresh random IV every time means the same text never looks the same twice.
async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return { iv: toB64(iv), ct: toB64(ct) };
}

// Decrypt. AES-GCM also detects tampering: if anyone changed a single bit, this throws.
async function decryptText(key, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ct));
  return dec.decode(pt);
}
