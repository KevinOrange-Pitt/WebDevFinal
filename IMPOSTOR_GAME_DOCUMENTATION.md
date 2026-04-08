# Impostor Party Game Documentation

## Overview
This project is a browser-based **multiplayer impostor game** built with **Node.js**, **Express**, **MongoDB**, and **Socket.IO**.

Players join the same room, one player is secretly chosen as the **impostor**, and the rest of the players get both:
- a **category**
- a **secret word** related to that category

The impostor only sees the **category**, not the word, and has to blend in during chat before everyone votes.

---

## Main Files

| File | Purpose |
|---|---|
| `server.js` | Runs the backend, handles auth, rooms, game logic, chat, voting, and Socket.IO events |
| `play.html` | Main multiplayer game screen |
| `play.js` | Frontend game logic for joining rooms, rendering players, chat, voting, and timer UI |
| `style.css` | Styling for the game interface |
| `home.html` | Landing page |
| `auth.js` | Sign-in / sign-up logic |
| `verify-impostor-flow.js` | Local automated test for the multiplayer flow |

---

## How the Game Works

### 1. Player enters the game
On `play.html`, the user enters a name and either:
- **creates a room**, or
- **joins a room** using a room code

The frontend in `play.js` connects to the server with:

```js
const socket = io();
```

This opens a live connection between the browser and the Node server.

### 2. Room creation and joining
In `server.js`, rooms are stored in memory using a `Map`:

```js
const rooms = new Map();
```

Each room stores:
- room code
- host ID
- list of players
- round status
- category and word
- impostor ID
- votes
- chat messages
- timer info
- winner info

### 3. Starting a round
When the host clicks **Start Round**, the frontend emits:

```js
socket.emit("game:start", { roomCode })
```

The server then:
1. checks that there are at least 3 players
2. picks a random category/word pair
3. randomly selects one player as the impostor
4. starts the discussion timer
5. sends updated game state to every connected player

### 4. Secret information
The server builds a custom room state for each player.

- **normal players** receive:
  - `Category: Food • Word: Pizza`
- **impostor** receives:
  - `Category: Food — no secret word this round. Blend in.`

This is important because each player gets a personalized view of the same round.

### 5. Chat phase
Players use the chat box to give clues without saying the word directly.

The frontend sends messages with:

```js
socket.emit("chat:send", { roomCode, message })
```

The server then:
- validates the message
- adds it to the room chat log
- broadcasts the updated room state back to all players

This makes the chat update instantly for everyone in the room.

### 6. Voting phase
During the round, each player chooses who they think the impostor is.

The frontend sends:

```js
socket.emit("game:vote", { roomCode, targetId })
```

The server:
- saves the vote
- checks whether all votes are in
- or waits until the timer ends
- then counts the votes and decides the round result

### 7. Timer and results
A round timer runs on the server. When the timer expires, the server automatically ends the round and tallies the votes.

After that, the server:
- reveals whether the impostor survived or got caught
- updates scores
- checks if someone reached the winning score
- either shows **round results** or a **match winner**

---

## How the Chat Section Works

The chat section is not just visual UI — it is powered by live Socket.IO events.

### Frontend responsibilities in `play.js`
- collect the user's text input
- send the message to the backend
- re-render the chat box whenever the server sends updated room data

### Backend responsibilities in `server.js`
- keep the room's recent chat messages in memory
- attach the author name and timestamp info
- broadcast the refreshed state to everyone in that room

This means the chat behaves like a real-time multiplayer chatroom rather than a static form.

---

## What Socket.IO Does in This Project

`Socket.IO` is the real-time communication layer between the browser and the server.

Instead of making normal one-time HTTP requests over and over, Socket.IO keeps an **open two-way connection** so both sides can instantly send updates.

### In this game, Socket.IO handles:
- room creation and joining
- live player list updates
- round start events
- secret role distribution
- chat messages
- voting updates
- countdown/timer synchronization
- winner/result updates

### Important events used
- `room:create`
- `room:join`
- `game:start`
- `game:vote`
- `chat:send`
- `room:state`

`room:state` is especially important because it pushes the latest room data back to each player whenever something changes.

---

## Why This Would Be Hard Without Socket.IO

Without `Socket.IO`, the project would be much harder to build cleanly.

### Problems without Socket.IO
You would likely need to use **polling**, meaning every browser would repeatedly ask the server things like:
- “Did chat change?”
- “Did anyone vote yet?”
- “Did the timer end?”
- “Did someone join the room?”

That causes several issues:

1. **More code complexity**  
   You would need many extra fetch requests and update loops.

2. **Slower updates**  
   Players might not see changes until the next poll interval.

3. **More server traffic**  
   Constant polling creates more unnecessary requests.

4. **Harder synchronization**  
   It becomes much harder to keep the timer, votes, and chat perfectly in sync across all players.

5. **Worse multiplayer experience**  
   Real-time party games depend on instant updates. Polling makes them feel delayed and unreliable.

### Why Socket.IO is a strong choice
Socket.IO solves this by giving the app:
- instant real-time communication
- cleaner event-based code
- easier room-based broadcasting
- better support for multiplayer gameplay

For this project, it is the right tool because the game depends on everyone seeing updates immediately.

---

## Database vs In-Memory State

### Stored in MongoDB
MongoDB is currently used for:
- user registration
- login information
- password hashing and account storage

### Stored in memory on the server
The actual live game room data is stored in memory using the `rooms` map.

That means:
- active games work while the server is running
- if the server restarts, current rooms and rounds are lost

This is normal for a class/demo project, but a larger production version would likely store more room data in a database or cache system.

---

## End-to-End Flow Summary

1. Player opens `play.html`
2. Browser connects with `Socket.IO`
3. Player creates or joins a room
4. Host starts round
5. Server chooses the impostor and secret word
6. Real players see **category + word**
7. Impostor sees **category only**
8. Everyone chats and gives clues
9. Players vote before the timer ends
10. Server counts votes and updates scores
11. If a player reaches the winning score, the match winner is shown

---

## Verification
The project was locally verified with the automated script:

```bash
node verify-impostor-flow.js
```

This checked:
- room creation
- player joining
- discussion phase
- impostor/crew clue differences
- timer behavior
- voting and results
- match winner flow

---

## Final Notes
This project is a good example of a **real-time multiplayer web app**.

The most important technical idea is that **Socket.IO keeps all players synchronized instantly**, which is what makes the chat, voting, and hidden-role gameplay feel live and interactive.