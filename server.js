require("dotenv").config(); // Load environment variables

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const db = require("./db"); // Import SQLite database connection

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors({ origin: "http://localhost:5175" })); // Allow requests from your frontend

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: "application/json" })); // For Stripe webhook

// Routes
app.get("/", (req, res) => {
    res.send("Node.js backend is running!");
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
        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: "Premium Content Subscription",
                            description: "Access to exclusive gated content",
                        },
                        unit_amount: 2000, // $20.00 (amount in cents)
                    },
                    quantity: 1,
                },
            ],
            mode: "payment",
            success_url: `${process.env.FRONTEND_URL}?success=true`,
            cancel_url: `${process.env.FRONTEND_URL}?canceled=true`,
            metadata: { userId },
        });
        res.json({ id: session.id });
    } catch (error) {
        console.error("Error creating checkout session:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Handles Stripe webhook events.
 */
app.post("/stripe-webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            console.log(`Checkout session completed for session ID: ${session.id}`);
            await handleCheckoutSessionCompleted(session);
            break;
        }
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

/**
 * Handles a completed checkout session to update user's subscription status in SQLite.
 */
async function handleCheckoutSessionCompleted(session) {
    const userId = session.metadata.userId;

    if (!userId) {
        console.error("Error: userId not found in session metadata.");
        return;
    }

    try {
        db.run(
            "UPDATE users SET isSubscribed = ? WHERE id = ?",
            [true, userId],
            function (err) {
                if (err) {
                    console.error("Error updating subscription status in SQLite:", err.message);
                } else if (this.changes > 0) {
                    console.log(`User ${userId} subscription status updated to True in SQLite.`);
                } else {
                    console.log(`User ${userId} not found in SQLite.`);
                }
            }
        );
    } catch (error) {
        console.error(`Error handling checkout session for user ${userId}:`, error);
    }
}

// Start the server
app.listen(PORT, () => {
    console.log(`Node.js backend listening on port ${PORT}`);
    console.log(`CORS enabled for: http://localhost:5175`);
});