const { io } = require("socket.io-client");

const URL = "http://localhost:3000";
const names = ["Alice", "Bob", "Cara"];
const clients = names.map((name) => ({
    name,
    socket: io(URL, { transports: ["websocket"], forceNew: true })
}));
const states = {};

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(condition, timeout = 8000, step = 50) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
            if (condition()) {
                clearInterval(timer);
                resolve();
                return;
            }

            if (Date.now() - start > timeout) {
                clearInterval(timer);
                reject(new Error("Timed out waiting for condition."));
            }
        }, step);
    });
}

function emitAck(socket, event, payload) {
    return new Promise((resolve) => {
        socket.emit(event, payload, (response) => resolve(response));
    });
}

async function runVerification() {
    clients.forEach(({ name, socket }) => {
        socket.on("room:state", (state) => {
            states[name] = state;
        });
    });

    await Promise.all(clients.map(({ socket }) => new Promise((resolve) => socket.on("connect", resolve))));

    const create = await emitAck(clients[0].socket, "room:create", { name: "Alice" });

    if (!create?.ok) {
        throw new Error(`Create room failed: ${JSON.stringify(create)}`);
    }

    const roomCode = create.roomCode;
    const joinBob = await emitAck(clients[1].socket, "room:join", { name: "Bob", roomCode });
    const joinCara = await emitAck(clients[2].socket, "room:join", { name: "Cara", roomCode });

    if (!joinBob?.ok || !joinCara?.ok) {
        throw new Error(`Join room failed: ${JSON.stringify({ joinBob, joinCara })}`);
    }

    await waitFor(() => names.every((name) => states[name]?.totalPlayers === 3));

    let round = 0;
    let matchWinner = null;
    let discussionVerified = false;
    let secretVerified = false;
    let timerVerified = false;
    let resultsVerified = false;

    while (!matchWinner && round < 8) {
        round += 1;
        const start = await emitAck(clients[0].socket, "game:start", { roomCode });

        if (!start?.ok) {
            throw new Error(`Start round failed on round ${round}: ${JSON.stringify(start)}`);
        }

        await waitFor(() => names.every((name) => states[name]?.phase === "discussion"));
        discussionVerified = true;

        const secrets = names.map((name) => states[name]?.secret || "");
        const impostorHints = secrets.filter((text) => text.includes("no secret word")).length;
        const crewHints = secrets.filter((text) => text.includes("Word:")).length;

        if (impostorHints === 1 && crewHints === 2) {
            secretVerified = true;
        }

        const remaining = (states.Alice?.roundEndsAt || 0) - Date.now();

        if (remaining > 60000 && remaining <= 76000) {
            timerVerified = true;
        }

        const aliceId = states.Alice.players.find((player) => player.name === "Alice").id;
        const bobId = states.Bob.players.find((player) => player.name === "Bob").id;

        const vote1 = await emitAck(clients[0].socket, "game:vote", { roomCode, targetId: bobId });
        const vote2 = await emitAck(clients[1].socket, "game:vote", { roomCode, targetId: aliceId });
        const vote3 = await emitAck(clients[2].socket, "game:vote", { roomCode, targetId: aliceId });

        if (!vote1?.ok || !vote2?.ok || !vote3?.ok) {
            throw new Error(`Voting failed on round ${round}: ${JSON.stringify({ vote1, vote2, vote3 })}`);
        }

        await waitFor(() => ["results", "match-winner"].includes(states.Alice?.phase));
        resultsVerified = true;
        matchWinner = states.Alice?.matchWinner || null;
        await delay(150);
    }

    return {
        roomCreated: true,
        totalPlayersVerified: states.Alice?.totalPlayers === 3,
        discussionVerified,
        secretVerified,
        timerVerified,
        resultsVerified,
        roundsPlayed: round,
        matchWinner
    };
}

runVerification()
    .then((result) => {
        console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
        console.error("SIMULATION_FAILED");
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await delay(300);
        clients.forEach(({ socket }) => socket.disconnect());
    });