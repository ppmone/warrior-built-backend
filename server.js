require("dotenv").config(); // Load environment variables

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const db = require("./db"); // Import SQLite database connection

const app = express();
const PORT = process.env.PORT || 5001;

// CORS configuration - must be before any routes
app.use(cors({
    origin: "http://localhost:5175",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    optionsSuccessStatus: 200
}));

// Handle preflight requests explicitly
app.options('*', cors());

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Add logging middleware to debug requests
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} - Origin: ${req.get('Origin')}`);
    next();
});

// Routes
app.get("/", (req, res) => {
    res.json({ message: "Node.js backend is running!" });
});

/**
 * Fetch subscription status for a user.
 */
app.get("/api/users/:userId/subscription", (req, res) => {
    const userId = req.params.userId;
    console.log(`Fetching subscription for user: ${userId}`);

    if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
    }

    db.get("SELECT isSubscribed FROM users WHERE id = ?", [userId], (err, row) => {
        if (err) {
            console.error("Database error:", err);
            res.status(500).json({ error: "Database error" });
        } else if (row) {
            console.log(`User found: ${userId}, subscribed: ${row.isSubscribed}`);
            res.json({ isSubscribed: Boolean(row.isSubscribed) });
        } else {
            console.log(`User not found, creating: ${userId}`);
            // If user doesn't exist, create them with default subscription status
            db.run("INSERT INTO users (id, isSubscribed) VALUES (?, ?)", [userId, false], function (insertErr) {
                if (insertErr) {
                    console.error("Insert error:", insertErr);
                    res.status(500).json({ error: "Database error" });
                } else {
                    console.log(`User created: ${userId}`);
                    res.json({ isSubscribed: false });
                }
            });
        }
    });
});

/**
 * Create a new user.
 */
app.post("/api/users", (req, res) => {
    const { id, email } = req.body;
    console.log(`Creating user: ${id}, email: ${email}`);

    if (!id || !email) {
        return res.status(400).json({ error: "User ID and email are required" });
    }

    // Use INSERT OR REPLACE to handle existing users
    db.run("INSERT OR REPLACE INTO users (id, email, isSubscribed) VALUES (?, ?, ?)", [id, email, false], function (err) {
        if (err) {
            console.error("Database error:", err);
            res.status(500).json({ error: "Database error" });
        } else {
            console.log(`User created successfully: ${id}`);
            res.json({ message: "User created successfully", userId: id });
        }
    });
});

/**
 * Creates a Stripe Checkout Session.
 */
app.post("/create-checkout-session", async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "User ID is required." });
    }

    try {
        // Add your Stripe checkout session creation logic here
        res.json({ message: "Checkout session endpoint ready" });
    } catch (error) {
        console.error("Error creating checkout session:", error);
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Backend is running on http://localhost:${PORT}`);
    console.log(`CORS enabled for: http://localhost:5175`);
    console.log('Server started successfully');
});