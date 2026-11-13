const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.static("public"));

// Who is in each room. Rooms are named by a SHA-256 fingerprint of the room code,
// so the server never learns the real code: { "9f86d0…": Set(["Mario", "Mr. Robot"]) }
const rooms = new Map();

function sendMembers(room) {
  io.to(room).emit("members", [...(rooms.get(room) || [])]);
}

io.on("connection", (socket) => {
  socket.on("join", ({ username, room }, reply) => {
    username = String(username || "").trim().slice(0, 20);
    room = String(room || "");
    if (!username) return reply({ ok: false, error: "Username is required" });
    if (!/^[0-9a-f]{64}$/.test(room)) return reply({ ok: false, error: "Invalid room" });

    if (!rooms.has(room)) rooms.set(room, new Set());
    if (rooms.get(room).has(username)) return reply({ ok: false, error: "That username is taken in this room" });

    rooms.get(room).add(username);
    socket.data.username = username;
    socket.data.room = room;
    socket.join(room);

    reply({ ok: true });
    io.to(room).emit("system", `${username} joined the room`);
    sendMembers(room);
  });

  // Messages arrive already encrypted. The server can't read them, it just passes them on.
  socket.on("message", (data) => {
    const { username, room } = socket.data;
    if (!room || !data) return;
    const { iv, ct } = data;
    if (typeof iv !== "string" || typeof ct !== "string" || iv.length > 32 || ct.length > 8000) return;
    io.to(room).emit("message", { username, data: { iv, ct }, time: Date.now() });
  });

  // Encrypted file chunks. The server checks sizes, then passes them on.
  // Nothing is saved: each chunk is forwarded and forgotten.
  const MAX_CHUNKS = 41; // 20 MB / 512 KB, plus one spare
  socket.on("file-chunk", (chunk, ack) => {
    const { username, room } = socket.data;
    if (!room || !chunk || typeof ack !== "function") return;
    const { id, index, total, iv, ct, meta } = chunk;
    const ok =
      typeof id === "string" && id.length <= 64 &&
      Number.isInteger(total) && total >= 1 && total <= MAX_CHUNKS &&
      Number.isInteger(index) && index >= 0 && index < total &&
      typeof iv === "string" && iv.length <= 32 &&
      Buffer.isBuffer(ct) && ct.length <= 512 * 1024 + 64 &&
      (meta === null || (typeof meta?.iv === "string" && typeof meta?.ct === "string" && meta.ct.length <= 2000));
    if (!ok) return ack();
    socket.to(room).emit("file-chunk", { username, id, index, total, iv, ct, meta });
    ack(); // tells the sender "got it, send the next one"
  });

  socket.on("disconnect", () => {
    const { username, room } = socket.data;
    if (!room) return;
    rooms.get(room)?.delete(username);
    if (rooms.get(room)?.size === 0) rooms.delete(room); // empty rooms vanish
    io.to(room).emit("system", `${username} left the room`);
    sendMembers(room);
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`CatChat running on port ${PORT}`));
