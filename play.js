const socket = io();

const storedUser = (() => {
    try {
        return JSON.parse(localStorage.getItem("trivcrackUser") || "null");
    } catch (error) {
        return null;
    }
})();

const elements = {
    feedback: document.getElementById("play-feedback"),
    setupPanel: document.getElementById("setup-panel"),
    gamePanel: document.getElementById("game-panel"),
    playerName: document.getElementById("player-name"),
    roomCodeInput: document.getElementById("room-code"),
    createRoomBtn: document.getElementById("create-room-btn"),
    joinRoomBtn: document.getElementById("join-room-btn"),
    roomCodeDisplay: document.getElementById("room-code-display"),
    phaseLabel: document.getElementById("phase-label"),
    lobbyStatus: document.getElementById("lobby-status"),
    playerCountChip: document.getElementById("player-count-chip"),
    timerChip: document.getElementById("timer-chip"),
    goalChip: document.getElementById("goal-chip"),
    winnerBanner: document.getElementById("winner-banner"),
    winnerText: document.getElementById("winner-text"),
    categoryText: document.getElementById("category-text"),
    secretText: document.getElementById("secret-text"),
    startRoundBtn: document.getElementById("start-round-btn"),
    playerList: document.getElementById("player-list"),
    voteStatus: document.getElementById("vote-status"),
    voteArea: document.getElementById("vote-area"),
    resultCard: document.getElementById("result-card"),
    resultSummary: document.getElementById("result-summary"),
    resultVotes: document.getElementById("result-votes"),
    copyRoomBtn: document.getElementById("copy-room-btn"),
    leaveRoomBtn: document.getElementById("leave-room-btn"),
    chatMessages: document.getElementById("chat-messages"),
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input")
};

let roomState = null;
let countdownInterval = null;

if (storedUser?.username) {
    elements.playerName.value = storedUser.username;
}

function setFeedback(message, isError = false) {
    elements.feedback.textContent = message;
    elements.feedback.style.color = isError ? "#b42318" : "#245bdb";
}

function getPlayerName() {
    return elements.playerName.value.trim();
}

function getRoomCode() {
    return elements.roomCodeInput.value.trim().toUpperCase();
}

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateTimerDisplay() {
    if (!roomState || roomState.phase !== "discussion" || !roomState.roundEndsAt) {
        elements.timerChip.textContent = roomState?.phase === "match-winner" ? "done" : "--";
        elements.timerChip.classList.remove("timer-live");
        return;
    }

    const remainingSeconds = Math.max(0, Math.ceil((roomState.roundEndsAt - Date.now()) / 1000));
    elements.timerChip.textContent = formatTime(remainingSeconds);
    elements.timerChip.classList.add("timer-live");
}

function ensureCountdown() {
    if (!countdownInterval) {
        countdownInterval = setInterval(updateTimerDisplay, 1000);
    }
}

function phaseText(state) {
    if (!state) {
        return "Waiting in lobby";
    }

    if (state.phase === "discussion") {
        return `Round ${state.round}: Discuss and vote`;
    }

    if (state.phase === "results") {
        return `Round ${state.round}: Results revealed`;
    }

    if (state.phase === "match-winner") {
        return `Match complete after round ${state.round}`;
    }

    return "Lobby open — waiting for the host";
}

function renderPlayers() {
    elements.playerList.innerHTML = "";

    const players = [...(roomState?.players || [])].sort((first, second) => second.score - first.score);

    players.forEach((player) => {
        const pill = document.createElement("div");
        pill.className = "player-pill";

        if (roomState?.you?.id === player.id) {
            pill.classList.add("current-player");
        }

        const name = document.createElement("strong");
        name.textContent = player.name;

        const meta = document.createElement("span");
        const suffix = [];

        if (player.isHost) {
            suffix.push("host");
        }

        if (
            (roomState?.phase === "results" || roomState?.phase === "match-winner") &&
            roomState?.lastResult?.impostorId === player.id
        ) {
            suffix.push("impostor");
        }

        meta.textContent = `${player.score} pts${suffix.length ? ` • ${suffix.join(" • ")}` : ""}`;
        pill.append(name, meta);
        elements.playerList.appendChild(pill);
    });
}

function renderVoting() {
    elements.voteArea.innerHTML = "";

    if (!roomState || roomState.phase !== "discussion") {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = roomState?.phase === "match-winner" ? "Match finished. Start a new one to vote again." : "Votes unlock once the round starts.";
        elements.voteArea.appendChild(empty);
        return;
    }

    const others = roomState.players.filter((player) => player.id !== roomState?.you?.id);

    others.forEach((player) => {
        const button = document.createElement("button");
        button.className = "vote-btn";
        button.textContent = roomState?.you?.voteTargetId === player.id ? `Voted: ${player.name}` : `Vote ${player.name}`;

        if (roomState?.you?.voteTargetId === player.id) {
            button.classList.add("selected");
        }

        button.disabled = Boolean(roomState?.you?.hasVoted);
        button.addEventListener("click", () => {
            socket.emit("game:vote", { roomCode: roomState.roomCode, targetId: player.id }, (response) => {
                if (!response?.ok) {
                    setFeedback(response?.message || "Vote could not be submitted.", true);
                    return;
                }

                setFeedback("Vote locked in. Waiting for the rest of the room.");
            });
        });

        elements.voteArea.appendChild(button);
    });
}

function renderResults() {
    const hasResults = Boolean(roomState?.lastResult);
    elements.resultCard.classList.toggle("hidden", !hasResults);

    if (!hasResults) {
        return;
    }

    const winnerLine = roomState.matchWinner
        ? ` ${roomState.matchWinner.name} wins the match with ${roomState.matchWinner.score} points.`
        : "";

    elements.resultSummary.textContent = `${roomState.lastResult.message} Secret word: ${roomState.lastResult.secretWord}.${winnerLine}`;
    elements.resultVotes.innerHTML = "";

    roomState.lastResult.votes.forEach((voteEntry) => {
        const item = document.createElement("li");
        item.textContent = `${voteEntry.playerName} → ${voteEntry.votedFor}`;
        elements.resultVotes.appendChild(item);
    });
}

function renderWinner() {
    const hasWinner = Boolean(roomState?.matchWinner);
    elements.winnerBanner.classList.toggle("hidden", !hasWinner);

    if (!hasWinner) {
        return;
    }

    elements.winnerText.textContent = `${roomState.matchWinner.name} reached ${roomState.matchWinner.score} points. Host can start a fresh match now.`;
}

function renderChat() {
    elements.chatMessages.innerHTML = "";

    (roomState?.chat || []).forEach((message) => {
        const wrapper = document.createElement("div");
        wrapper.className = `chat-message${message.system ? " system" : ""}`;

        const author = document.createElement("strong");
        author.textContent = message.system ? "System" : message.author;

        const text = document.createElement("span");
        text.textContent = message.text;

        wrapper.append(author, text);
        elements.chatMessages.appendChild(wrapper);
    });

    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function render() {
    const inRoom = Boolean(roomState);
    elements.setupPanel.classList.toggle("hidden", inRoom);
    elements.gamePanel.classList.toggle("hidden", !inRoom);

    if (!inRoom) {
        return;
    }

    elements.roomCodeDisplay.textContent = roomState.roomCode;
    elements.phaseLabel.textContent = phaseText(roomState);
    elements.playerCountChip.textContent = `${roomState.totalPlayers} / 3+`;
    elements.goalChip.textContent = `${roomState.winningScore} pts`;
    elements.categoryText.textContent = roomState.category
        ? `Category: ${roomState.category}`
        : "When the round starts, everyone sees the category.";
    elements.secretText.textContent = roomState.secret || "Real players will also see the word here.";
    elements.secretText.style.color = roomState?.you?.role === "impostor" ? "#b42318" : "#333";

    const waitingFor = Math.max(0, 3 - roomState.totalPlayers);

    if (roomState.phase === "lobby") {
        elements.lobbyStatus.textContent = waitingFor
            ? `Waiting for ${waitingFor} more player${waitingFor === 1 ? "" : "s"} to begin.`
            : `Lobby ready. First to ${roomState.winningScore} points wins the match.`;
    } else if (roomState.phase === "discussion") {
        elements.lobbyStatus.textContent = "Discuss the clue before the timer ends, then vote.";
    } else if (roomState.phase === "results") {
        elements.lobbyStatus.textContent = "Round complete. Host can start the next one.";
    } else {
        elements.lobbyStatus.textContent = `${roomState.matchWinner?.name || "A player"} won the match.`;
    }

    const isHost = roomState.hostId === roomState?.you?.id;
    elements.startRoundBtn.disabled = !isHost || roomState.players.length < 3;
    elements.startRoundBtn.textContent =
        roomState.phase === "match-winner"
            ? "Start New Match"
            : roomState.phase === "results"
              ? "Start Next Round"
              : "Start Round";

    if (roomState.phase === "discussion") {
        elements.voteStatus.textContent = `${roomState.submittedVotes}/${roomState.totalPlayers} votes locked in.`;
    } else if (roomState.phase === "results" || roomState.phase === "match-winner") {
        elements.voteStatus.textContent = roomState.lastResult?.message || "Round finished.";
    } else {
        elements.voteStatus.textContent = "Waiting in lobby. Need at least 3 players.";
    }

    updateTimerDisplay();
    renderPlayers();
    renderVoting();
    renderResults();
    renderWinner();
    renderChat();
}

function createRoom() {
    const name = getPlayerName();

    if (name.length < 2) {
        setFeedback("Pick a nickname with at least 2 characters.", true);
        return;
    }

    socket.emit("room:create", { name }, (response) => {
        if (!response?.ok) {
            setFeedback(response?.message || "Unable to create a room.", true);
            return;
        }

        elements.roomCodeInput.value = response.roomCode;
        setFeedback(`Room ${response.roomCode} created. Share it with your friends.`);
    });
}

function joinRoom() {
    const name = getPlayerName();
    const roomCode = getRoomCode();

    if (name.length < 2) {
        setFeedback("Pick a nickname with at least 2 characters.", true);
        return;
    }

    if (!roomCode) {
        setFeedback("Enter the room code to join a game.", true);
        return;
    }

    socket.emit("room:join", { name, roomCode }, (response) => {
        if (!response?.ok) {
            setFeedback(response?.message || "Unable to join that room.", true);
            return;
        }

        setFeedback(`Joined room ${response.roomCode}. Wait for the host to start.`);
    });
}

elements.createRoomBtn.addEventListener("click", createRoom);
elements.joinRoomBtn.addEventListener("click", joinRoom);

elements.startRoundBtn.addEventListener("click", () => {
    if (!roomState) {
        return;
    }

    socket.emit("game:start", { roomCode: roomState.roomCode }, (response) => {
        if (!response?.ok) {
            setFeedback(response?.message || "Could not start the round.", true);
            return;
        }

        setFeedback(
            roomState.phase === "match-winner"
                ? "New match started. Everyone has fresh scores."
                : "Round started. Read your clue and start bluffing."
        );
    });
});

elements.copyRoomBtn.addEventListener("click", async () => {
    if (!roomState) {
        return;
    }

    try {
        await navigator.clipboard.writeText(roomState.roomCode);
        setFeedback(`Copied room code ${roomState.roomCode}.`);
    } catch (error) {
        setFeedback("Could not copy the room code automatically.", true);
    }
});

elements.leaveRoomBtn.addEventListener("click", () => {
    socket.disconnect();
    window.location.reload();
});

elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!roomState) {
        return;
    }

    const message = elements.chatInput.value.trim();

    if (!message) {
        return;
    }

    socket.emit("chat:send", { roomCode: roomState.roomCode, message }, (response) => {
        if (!response?.ok) {
            setFeedback(response?.message || "Message failed to send.", true);
            return;
        }

        elements.chatInput.value = "";
    });
});

socket.on("room:state", (nextState) => {
    roomState = nextState;
    render();
});

socket.on("room:error", (message) => {
    setFeedback(message || "Something went wrong.", true);
});

socket.on("disconnect", () => {
    if (roomState) {
        setFeedback("Disconnected from the room. Refresh to reconnect.", true);
    }
});

ensureCountdown();