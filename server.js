const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.static("public"));

// Who is in each room: { "1234": Set(["Mario", "Mr. Robot"]) }
const rooms = new Map();

function sendMembers(room) {
  io.to(room).emit("members", [...(rooms.get(room) || [])]);
}

io.on("connection", (socket) => {
  socket.on("join", ({ username, room }, reply) => {
    username = String(username || "").trim().slice(0, 20);
    room = String(room || "").trim().slice(0, 30);
    if (!username || !room) return reply({ ok: false, error: "Username and room code are required" });

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

  socket.on("message", (text) => {
    const { username, room } = socket.data;
    text = String(text || "").trim().slice(0, 1000);
    if (!room || !text) return;
    io.to(room).emit("message", { username, text, time: Date.now() });
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
