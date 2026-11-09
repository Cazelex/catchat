const socket = io();
const $ = (id) => document.getElementById(id);
let me = "";

// 1. Login: send username + room to the server
$("login").addEventListener("submit", (e) => {
  e.preventDefault(); // stop the page reloading
  const username = $("username").value.trim();
  const room = $("room").value.trim();

  socket.emit("join", { username, room }, (res) => {
    if (!res.ok) return ($("error").textContent = res.error);
    me = username;
    $("room-name").textContent = room;
    $("login").hidden = true;   // swap screens
    $("chat").hidden = false;
    $("text").focus();
  });
});

// 2. Sending messages
$("send").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  if (text) socket.emit("message", text);
  $("text").value = "";
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

socket.on("message", ({ username, text, time }) => {
  const div = addLine("", username === me ? "msg mine" : "msg");
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
