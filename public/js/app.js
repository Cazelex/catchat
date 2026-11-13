const socket = io();
const $ = (id) => document.getElementById(id);
let me = "";
let key = null; // encryption key, made from the room code, never leaves this browser

// 1. Login: the real room code stays here. The server only gets its fingerprint.
$("login").addEventListener("submit", async (e) => {
  e.preventDefault(); // stop the page reloading
  const username = $("username").value.trim();
  const room = $("room").value.trim();

  if (!window.crypto?.subtle) {
    return ($("error").textContent = "Encryption needs HTTPS. Open CatChat at https://catchat.co.za");
  }
  key = await keyFor(room);
  const roomId = await roomIdFor(room);

  socket.emit("join", { username, room: roomId }, (res) => {
    if (!res.ok) return ($("error").textContent = res.error);
    me = username;
    $("room-name").textContent = room;
    $("login").hidden = true;   // swap screens
    $("chat").hidden = false;
    $("text").focus();
  });
});

// 2. Sending messages
$("send").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  $("text").value = "";
  if (text) socket.emit("message", await encryptText(key, text)); // encrypted before it leaves
});

$("leave").addEventListener("click", () => location.reload());

// 3. Things the server sends us
socket.on("members", (list) => {
  $("members").innerHTML = "";
  for (const name of list) {
    const li = document.createElement("li");
    li.textContent = name + (name === me ? " (you)" : "");
    $("members").appendChild(li);
  }
});

socket.on("system", (text) => addLine(text, "system"));

socket.on("message", async ({ username, data, time }) => {
  let text, locked = false;
  try {
    text = await decryptText(key, data);
  } catch {
    text = "🔒 This message couldn't be decrypted";
    locked = true;
  }
  const div = addLine("", (username === me ? "msg mine" : "msg") + (locked ? " locked" : ""));
  const who = document.createElement("small");
  who.textContent = `${username} · ${new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const body = document.createElement("div");
  body.textContent = text; // textContent, never innerHTML, so nobody can inject code
  div.append(who, body);
});

function addLine(text, cls) {
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = text;
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
  return div;
}

// ---------------- File sharing (end-to-end encrypted) ----------------
// Files are split into 512 KB chunks. Each chunk is encrypted separately and sent
// through the server, which only passes the scrambled bytes on and never saves them.

const MAX_FILE = 20 * 1024 * 1024; // 20 MB
const CHUNK = 512 * 1024;          // 512 KB
const PREVIEW_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const incoming = new Map();        // files still arriving, by id

$("attach").addEventListener("click", () => $("file").click());

$("file").addEventListener("change", async () => {
  const file = $("file").files[0];
  $("file").value = "";
  if (!file) return;
  if (file.size > MAX_FILE) return addLine("File is too big (max 20 MB)", "system");

  const id = crypto.randomUUID();
  const total = Math.max(1, Math.ceil(file.size / CHUNK));
  const meta = await encryptText(key, JSON.stringify({ name: file.name, type: file.type, size: file.size }));
  const card = fileCard(me, "Sending… 0%", true);

  for (let i = 0; i < total; i++) {
    const bytes = await file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer();
    const { iv, ct } = await encryptBytes(key, bytes);
    await new Promise((done) =>
      socket.emit("file-chunk", { id, index: i, total, iv, ct, meta: i === 0 ? meta : null }, done)
    );
    card.status.textContent = `Sending… ${Math.round(((i + 1) / total) * 100)}%`;
  }
  showFile(card, file, file.name, file.type, file.size); // show our own copy straight away
});

socket.on("file-chunk", async ({ username, id, index, total, iv, ct, meta }) => {
  let f = incoming.get(id);
  if (!f) {
    f = { username, total, parts: new Array(total), got: 0, card: fileCard(username, "Receiving… 0%", false) };
    incoming.set(id, f);
  }
  try {
    if (meta) f.meta = JSON.parse(await decryptText(key, meta));
    f.parts[index] = await decryptBytes(key, iv, ct);
  } catch {
    f.card.status.textContent = "🔒 This file couldn't be decrypted";
    incoming.delete(id);
    return;
  }
  f.got++;
  f.card.status.textContent = `Receiving… ${Math.round((f.got / f.total) * 100)}%`;

  if (f.got === f.total && f.meta) {
    incoming.delete(id);
    const { name, type, size } = f.meta;
    showFile(f.card, new Blob(f.parts), name, type, size);
  }
});

// A chat bubble for a file, updated as it sends/arrives
function fileCard(username, statusText, mine) {
  const div = addLine("", mine ? "msg mine" : "msg");
  const who = document.createElement("small");
  who.textContent = `${username} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const box = document.createElement("div");
  box.className = "file-card";
  const status = document.createElement("span");
  status.className = "size";
  status.textContent = statusText;
  box.append(status);
  div.append(who, box);
  return { box, status };
}

function showFile(card, blob, name, type, size) {
  // Only real image types get previewed. Everything else is a plain download,
  // so a dangerous file (HTML, SVG, scripts) can never run inside CatChat.
  const safeType = PREVIEW_TYPES.includes(type) ? type : "application/octet-stream";
  const url = URL.createObjectURL(new Blob([blob], { type: safeType }));

  if (PREVIEW_TYPES.includes(type)) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = name;
    card.box.prepend(img);
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.textContent = "📄 " + name; // textContent, so a filename can't inject code
  card.box.insertBefore(link, card.status);
  card.status.textContent = formatSize(size);
  $("messages").scrollTop = $("messages").scrollHeight;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
