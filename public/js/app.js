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
