const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGO_URI;

let mongoConnected = false;
let mongoClient;
let usersCollection;

function hashPassword(password) {
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
        const passwordHash = hashPassword(password);
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

        if (!user || !verifyPassword(password, user.passwordHash)) {
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

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

async function startServer() {
    try {
        await connectMongo();
    } catch (err) {
        console.error("MongoDB connection failed:", err.message);
    }

    app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
}

startServer();
