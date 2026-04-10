const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

server.keepAliveTimeout = 125000;
server.headersTimeout = 126000;

const io = new Server(server, {
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 60000,
    cors: {
        origin: true,
        credentials: true
    }
});
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGO_URI;

let mongoConnected = false;
let mongoClient;
let usersCollection;

const WORD_SETS = [
    { category: "Food", word: "Pizza" },
    { category: "Animal", word: "Tiger" },
    { category: "Movie", word: "Titanic" },
    { category: "Place", word: "Beach" },
    { category: "Job", word: "Teacher" },
    { category: "Sport", word: "Soccer" },
    { category: "Object", word: "Backpack" },
    { category: "Weather", word: "Thunderstorm" },
    { category: "Space", word: "Mars" },
    { category: "Music", word: "Guitar" }
];

const rooms = new Map();
const ROUND_DURATION_MS = 75000;
const WINNING_SCORE = 5;
const RECONNECT_GRACE_MS = 90000;

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue) {
    const [salt, originalHash] = storedValue.split(":");

    if (!salt || !originalHash) {
        return false;
    }

    const testHash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(testHash, "hex"), Buffer.from(originalHash, "hex"));
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeName(value) {
    return (value || "").trim().replace(/\s+/g, " ").slice(0, 20);
}

function normalizeRoomCode(value) {
    return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function normalizePlayerKey(value) {
    return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function generateRoomCode() {
    let code = "";

    do {
        code = Math.random().toString(36).slice(2, 6).toUpperCase();
    } while (rooms.has(code));

    return code;
}

function ensureUniquePlayerName(room, requestedName) {
    const baseName = normalizeName(requestedName) || "Guest";
    const takenNames = new Set(room.players.map((player) => player.name.toLowerCase()));
    let candidate = baseName;
    let counter = 2;

    while (takenNames.has(candidate.toLowerCase())) {
        candidate = `${baseName.slice(0, Math.max(1, 18 - String(counter).length))} ${counter}`;
        counter += 1;
    }

    return candidate;
}

function createPlayer(socketId, name, playerKey) {
    return {
        id: socketId,
        playerKey,
        name,
        score: 0,
        role: null,
        connected: true,
        disconnectTimer: null,
        disconnectDeadline: null
    };
}

function clearDisconnectTimer(player) {
    if (player?.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
    }

    if (player) {
        player.disconnectDeadline = null;
    }
}

function remapPlayerReferences(room, previousSocketId, nextSocketId) {
    if (!room || !previousSocketId || !nextSocketId || previousSocketId === nextSocketId) {
        return;
    }

    if (room.hostId === previousSocketId) {
        room.hostId = nextSocketId;
    }

    if (room.impostorId === previousSocketId) {
        room.impostorId = nextSocketId;
    }

    if (room.votes[previousSocketId]) {
        room.votes[nextSocketId] = room.votes[previousSocketId];
        delete room.votes[previousSocketId];
    }

    Object.entries(room.votes).forEach(([voterId, targetId]) => {
        if (targetId === previousSocketId) {
            room.votes[voterId] = nextSocketId;
        }
    });
}

function clearRoundTimer(room) {
    if (room.roundTimer) {
        clearTimeout(room.roundTimer);
        room.roundTimer = null;
    }

    room.roundEndsAt = null;
}

function resetRound(room, nextPhase = "lobby", options = {}) {
    const { resetScores = false } = options;

    clearRoundTimer(room);
    room.phase = nextPhase;
    room.category = null;
    room.secretWord = null;
    room.impostorId = null;
    room.votes = {};
    room.lastResult = null;
    room.matchWinner = null;
    room.players = room.players.map((player) => ({
        ...player,
        score: resetScores ? 0 : player.score,
        role: null
    }));

    if (resetScores) {
        room.round = 0;
    }
}

function addChatMessage(room, text, options = {}) {
    const { system = false, author = "System" } = options;

    room.chat.push({
        id: crypto.randomUUID(),
        author,
        text,
        system,
        createdAt: new Date().toISOString()
    });

    room.chat = room.chat.slice(-40);
}

function getPublicRoomState(room, viewerId) {
    const you = room.players.find((player) => player.id === viewerId);
    const submittedVotes = Object.keys(room.votes || {}).length;

    return {
        roomCode: room.code,
        phase: room.phase,
        round: room.round,
        hostId: room.hostId,
        category: room.category,
        roundEndsAt: room.roundEndsAt,
        winningScore: room.winningScore,
        matchWinner: room.matchWinner,
        players: room.players.map((player) => ({
            id: player.id,
            name: player.name,
            score: player.score,
            isHost: player.id === room.hostId,
            connected: player.connected !== false
        })),
        you: you
            ? {
                  id: you.id,
                  name: you.name,
                  score: you.score,
                  role:
                      room.phase === "discussion" || room.phase === "results" || room.phase === "match-winner"
                          ? you.role
                          : null,
                  hasVoted: Boolean(room.votes[viewerId]),
                  voteTargetId: room.votes[viewerId] || null
              }
            : null,
        submittedVotes,
        totalPlayers: room.players.length,
        chat: room.chat,
        lastResult: room.lastResult,
        secret: !you || !room.category
            ? null
            : you.role === "impostor"
              ? `Category: ${room.category} — no secret word this round. Blend in.`
              : `Category: ${room.category} • Word: ${room.secretWord}`
    };
}

function emitRoomState(roomCode) {
    const room = rooms.get(roomCode);

    if (!room) {
        return;
    }

    room.players.forEach((player) => {
        io.to(player.id).emit("room:state", getPublicRoomState(room, player.id));
    });
}

function pickWordSet() {
    return WORD_SETS[Math.floor(Math.random() * WORD_SETS.length)];
}

function startRound(room) {
    if (room.players.length < 3) {
        return { ok: false, message: "At least 3 players are needed to start." };
    }

    if (room.phase === "discussion") {
        return { ok: false, message: "Finish the current round before starting a new one." };
    }

    if (room.phase === "match-winner") {
        resetRound(room, "lobby", { resetScores: true });
    }

    clearRoundTimer(room);
    const selectedSet = pickWordSet();
    const impostor = room.players[Math.floor(Math.random() * room.players.length)];

    room.round += 1;
    room.phase = "discussion";
    room.category = selectedSet.category;
    room.secretWord = selectedSet.word;
    room.impostorId = impostor.id;
    room.votes = {};
    room.lastResult = null;
    room.matchWinner = null;
    room.roundEndsAt = Date.now() + ROUND_DURATION_MS;
    room.players = room.players.map((player) => ({
        ...player,
        role: player.id === room.impostorId ? "impostor" : "crewmate"
    }));

    room.roundTimer = setTimeout(() => {
        const currentRoom = rooms.get(room.code);

        if (currentRoom && currentRoom.phase === "discussion") {
            addChatMessage(currentRoom, "Time is up. Votes are being counted.", { system: true });
            tallyVotes(currentRoom);
        }
    }, ROUND_DURATION_MS);

    addChatMessage(room, `Round ${room.round} started. Category: ${room.category}. You have 75 seconds.`, {
        system: true
    });
    emitRoomState(room.code);

    return { ok: true };
}

function tallyVotes(room) {
    clearRoundTimer(room);
    const counts = {};

    Object.values(room.votes).forEach((targetId) => {
        counts[targetId] = (counts[targetId] || 0) + 1;
    });

    const sortedVotes = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const votedOutId =
        sortedVotes.length === 1 || (sortedVotes[0] && sortedVotes[1] && sortedVotes[0][1] > sortedVotes[1][1])
            ? sortedVotes[0]?.[0] || null
            : null;

    const votedOutPlayer = room.players.find((player) => player.id === votedOutId);
    const impostor = room.players.find((player) => player.id === room.impostorId);
    let winner = "impostor";
    let message = "No clear vote. The impostor slipped away.";

    if (votedOutId && votedOutId === room.impostorId) {
        winner = "crew";
        message = `${votedOutPlayer.name} was the impostor. Crew wins this round!`;
        room.players = room.players.map((player) =>
            player.id === room.impostorId ? player : { ...player, score: player.score + 1 }
        );
    } else {
        if (votedOutPlayer) {
            message = `${votedOutPlayer.name} was not the impostor. ${impostor?.name || "The impostor"} wins!`;
        }

        room.players = room.players.map((player) =>
            player.id === room.impostorId ? { ...player, score: player.score + 2 } : player
        );
    }

    const leader = [...room.players].sort((first, second) => second.score - first.score)[0];
    const matchWinner = leader && leader.score >= room.winningScore ? leader : null;

    room.phase = matchWinner ? "match-winner" : "results";
    room.matchWinner = matchWinner
        ? {
              id: matchWinner.id,
              name: matchWinner.name,
              score: matchWinner.score
          }
        : null;
    room.lastResult = {
        winner,
        message,
        impostorId: room.impostorId,
        impostorName: impostor ? impostor.name : "Unknown",
        secretWord: room.secretWord,
        votes: room.players.map((player) => ({
            playerName: player.name,
            votedFor: room.players.find((candidate) => candidate.id === room.votes[player.id])?.name || "No vote"
        }))
    };

    addChatMessage(room, message, { system: true });

    if (room.matchWinner) {
        addChatMessage(room, `🏆 ${room.matchWinner.name} reached ${room.matchWinner.score} points and won the match!`, {
            system: true
        });
    }

    emitRoomState(room.code);
}

function finalizePlayerRemoval(roomCode, socketId) {
    const room = rooms.get(roomCode);
    const player = room?.players.find((entry) => entry.id === socketId);

    if (!room || !player) {
        return;
    }

    clearDisconnectTimer(player);
    room.players = room.players.filter((entry) => entry.id !== socketId);
    delete room.votes[socketId];

    Object.entries(room.votes).forEach(([voterId, targetId]) => {
        if (targetId === socketId) {
            delete room.votes[voterId];
        }
    });

    addChatMessage(room, `${player.name} left the room.`, { system: true });

    if (room.players.length === 0) {
        clearRoundTimer(room);
        rooms.delete(roomCode);
        return;
    }

    if (room.hostId === socketId) {
        room.hostId = room.players[0].id;
        addChatMessage(room, `${room.players[0].name} is now the host.`, { system: true });
    }

    if (room.phase === "discussion" && (room.players.length < 3 || socketId === room.impostorId)) {
        resetRound(room, "lobby");
        addChatMessage(room, "Round cancelled and returned to the lobby.", { system: true });
    } else if (room.phase === "discussion" && Object.keys(room.votes).length === room.players.length) {
        tallyVotes(room);
        return;
    }

    emitRoomState(roomCode);
}

function removePlayerFromRooms(socketId, options = {}) {
    const { allowReconnect = false } = options;

    for (const [roomCode, room] of rooms.entries()) {
        const player = room.players.find((entry) => entry.id === socketId);

        if (!player) {
            continue;
        }

        if (allowReconnect) {
            if (player.disconnectTimer) {
                continue;
            }

            player.connected = false;
            player.disconnectDeadline = Date.now() + RECONNECT_GRACE_MS;
            player.disconnectTimer = setTimeout(() => {
                const latestRoom = rooms.get(roomCode);
                const latestPlayer = latestRoom?.players.find((entry) => entry.id === socketId);

                if (latestRoom && latestPlayer && latestPlayer.connected === false) {
                    finalizePlayerRemoval(roomCode, socketId);
                }
            }, RECONNECT_GRACE_MS);

            addChatMessage(room, `${player.name} disconnected. Holding their spot for 90 seconds.`, {
                system: true
            });
            emitRoomState(roomCode);
            continue;
        }

        finalizePlayerRemoval(roomCode, socketId);
    }
}

async function connectMongo() {
    if (!mongoUri) {
        console.warn("MONGO_URI is not set. MongoDB will be unavailable.");
        return;
    }

    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    const db = mongoClient.db("trivcrack");
    usersCollection = db.collection("users");
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    mongoConnected = true;
    console.log("Connected to MongoDB.");
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.post("/api/auth/register", async (req, res) => {
    if (!mongoConnected || !usersCollection) {
        return res.status(503).json({ message: "Database is not connected." });
    }

    const { username, email, password } = req.body;
    const trimmedUsername = (username || "").trim();
    const trimmedEmail = (email || "").trim().toLowerCase();

    if (trimmedUsername.length < 2) {
        return res.status(400).json({ message: "Username must be at least 2 characters." });
    }

    if (!isValidEmail(trimmedEmail)) {
        return res.status(400).json({ message: "Please enter a valid email address." });
    }

    if (!password || password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters." });
    }

    try {
        const passwordHash = await hashPassword(password);
        await usersCollection.insertOne({
            username: trimmedUsername,
            email: trimmedEmail,
            passwordHash,
            createdAt: new Date()
        });

        return res.status(201).json({
            message: "Account created successfully.",
            user: { username: trimmedUsername, email: trimmedEmail }
        });
    } catch (err) {
        if (err && err.code === 11000) {
            return res.status(409).json({ message: "An account with this email already exists." });
        }

        return res.status(500).json({ message: "Failed to create account." });
    }
});

app.post("/api/auth/login", async (req, res) => {
    if (!mongoConnected || !usersCollection) {
        return res.status(503).json({ message: "Database is not connected." });
    }

    const { email, password } = req.body;
    const trimmedEmail = (email || "").trim().toLowerCase();

    if (!isValidEmail(trimmedEmail) || !password) {
        return res.status(400).json({ message: "Email and password are required." });
    }

    try {
        const user = await usersCollection.findOne({ email: trimmedEmail });

        if (!user || !(await verifyPassword(password, user.passwordHash)) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        return res.json({
            message: "Login successful.",
            user: {
                username: user.username,
                email: user.email
            }
        });
    } catch (err) {
        return res.status(500).json({ message: "Failed to sign in." });
    }
});

app.get("/api/health", async (req, res) => {
    if (!mongoUri) {
        return res.status(500).json({
            mongoConnected: false,
            message: "Backend is up, but MONGO_URI is missing in environment variables."
        });
    }

    if (!mongoConnected || !mongoClient) {
        return res.status(500).json({
            mongoConnected: false,
            message: "Backend is up, but MongoDB is not connected yet."
        });
    }

    try {
        await mongoClient.db("admin").command({ ping: 1 });
        return res.json({
            mongoConnected: true,
            message: "Backend and MongoDB are connected."
        });
    } catch (err) {
        mongoConnected = false;
        return res.status(500).json({
            mongoConnected: false,
            message: "MongoDB ping failed. Check network whitelist/firewall and URI."
        });
    }
});

io.on("connection", (socket) => {
    socket.on("room:create", (payload = {}, callback = () => {}) => {
        const requestedName = normalizeName(payload.name);
        const playerKey = normalizePlayerKey(payload.playerKey) || crypto.randomUUID();

        if (requestedName.length < 2) {
            callback({ ok: false, message: "Enter a name with at least 2 characters." });
            return;
        }

        const customRoomCode = normalizeRoomCode(payload.roomCode);
        const roomCode = customRoomCode || generateRoomCode();

        if (rooms.has(roomCode)) {
            callback({ ok: false, message: "That room code is already in use." });
            return;
        }

        removePlayerFromRooms(socket.id);
        const room = {
            code: roomCode,
            hostId: socket.id,
            players: [createPlayer(socket.id, requestedName, playerKey)],
            phase: "lobby",
            round: 0,
            category: null,
            secretWord: null,
            impostorId: null,
            votes: {},
            lastResult: null,
            roundEndsAt: null,
            roundTimer: null,
            winningScore: WINNING_SCORE,
            matchWinner: null,
            chat: []
        };

        addChatMessage(room, `${requestedName} created the room. Share code ${roomCode} with friends.`, { system: true });
        rooms.set(roomCode, room);
        socket.join(roomCode);
        callback({ ok: true, roomCode, playerName: requestedName, playerKey });
        emitRoomState(roomCode);
    });

    socket.on("room:join", (payload = {}, callback = () => {}) => {
        const requestedName = normalizeName(payload.name);
        const roomCode = normalizeRoomCode(payload.roomCode);
        const playerKey = normalizePlayerKey(payload.playerKey) || crypto.randomUUID();

        if (requestedName.length < 2) {
            callback({ ok: false, message: "Enter a name with at least 2 characters." });
            return;
        }

        if (!roomCode || !rooms.has(roomCode)) {
            callback({ ok: false, message: "That room code was not found." });
            return;
        }

        removePlayerFromRooms(socket.id);
        const room = rooms.get(roomCode);
        const reconnectingPlayer = room.players.find(
            (entry) => entry.playerKey === playerKey && entry.connected === false
        );

        if (reconnectingPlayer) {
            const previousSocketId = reconnectingPlayer.id;

            clearDisconnectTimer(reconnectingPlayer);
            reconnectingPlayer.id = socket.id;
            reconnectingPlayer.connected = true;
            remapPlayerReferences(room, previousSocketId, socket.id);
            socket.join(roomCode);
            addChatMessage(room, `${reconnectingPlayer.name} reconnected.`, { system: true });
            callback({ ok: true, roomCode, playerName: reconnectingPlayer.name, playerKey, rejoined: true });
            emitRoomState(roomCode);
            return;
        }

        const uniqueName = ensureUniquePlayerName(room, requestedName);
        room.players.push(createPlayer(socket.id, uniqueName, playerKey));
        addChatMessage(room, `${uniqueName} joined the room.`, { system: true });
        socket.join(roomCode);
        callback({ ok: true, roomCode, playerName: uniqueName, playerKey });
        emitRoomState(roomCode);
    });

    socket.on("game:start", ({ roomCode } = {}, callback = () => {}) => {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const room = rooms.get(normalizedRoomCode);

        if (!room) {
            callback({ ok: false, message: "Room not found." });
            return;
        }

        if (room.hostId !== socket.id) {
            callback({ ok: false, message: "Only the host can start the round." });
            return;
        }

        callback(startRound(room));
    });

    socket.on("game:vote", ({ roomCode, targetId } = {}, callback = () => {}) => {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const room = rooms.get(normalizedRoomCode);
        const player = room?.players.find((entry) => entry.id === socket.id);
        const target = room?.players.find((entry) => entry.id === targetId);

        if (!room || !player) {
            callback({ ok: false, message: "Room not found." });
            return;
        }

        if (room.phase !== "discussion") {
            callback({ ok: false, message: "Voting is only open during a live round." });
            return;
        }

        if (!target || target.id === socket.id) {
            callback({ ok: false, message: "Choose another player to vote for." });
            return;
        }

        if (room.votes[socket.id]) {
            callback({ ok: false, message: "You have already locked in your vote." });
            return;
        }

        room.votes[socket.id] = target.id;
        addChatMessage(room, `${player.name} locked in a vote.`, { system: true });

        if (Object.keys(room.votes).length === room.players.length) {
            tallyVotes(room);
        } else {
            emitRoomState(room.code);
        }

        callback({ ok: true });
    });

    socket.on("chat:send", ({ roomCode, message } = {}, callback = () => {}) => {
        const normalizedRoomCode = normalizeRoomCode(roomCode);
        const room = rooms.get(normalizedRoomCode);
        const player = room?.players.find((entry) => entry.id === socket.id);
        const trimmedMessage = (message || "").trim().slice(0, 220);

        if (!room || !player) {
            callback({ ok: false, message: "Room not found." });
            return;
        }

        if (!trimmedMessage) {
            callback({ ok: false, message: "Write a message before sending." });
            return;
        }

        addChatMessage(room, trimmedMessage, { author: player.name });
        emitRoomState(room.code);
        callback({ ok: true });
    });

    socket.on("disconnect", () => {
        removePlayerFromRooms(socket.id, { allowReconnect: true });
    });
});

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

async function startServer() {
    try {
        await connectMongo();
    } catch (err) {
        console.error("MongoDB connection failed:", err.message);
    }

    server.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
}

startServer();
