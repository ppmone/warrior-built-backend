// index.js (or app.js)
require("dotenv").config(); // LOAD ENVIRONMENT VARIABLES FIRST!

const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs"); // Added to read service account key file
// Removed: const functions = require("firebase-functions"); // No longer needed

// --- DEBUG: Check Environment Variables ---
console.log("DEBUG: process.env.STRIPE_SECRET_KEY =", process.env.STRIPE_SECRET_KEY ? "CONFIGURED" : "NOT CONFIGURED");
console.log("DEBUG: process.env.STRIPE_WEBHOOK_SECRET =", process.env.STRIPE_WEBHOOK_SECRET ? "CONFIGURED" : "NOT CONFIGURED");
console.log("DEBUG: process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH =", process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
console.log("DEBUG: process.env.RECAPTCHA_SECRET_KEY =", process.env.RECAPTCHA_SECRET_KEY ? "CONFIGURED" : "NOT CONFIGURED");
console.log("DEBUG: process.env.FRONTEND_URL =", process.env.FRONTEND_URL);
console.log("DEBUG: process.env.PORT =", process.env.PORT);
// --- END DEBUG ---


// Stripe Initialization - now directly from process.env
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

let stripe; // Declare stripe globally but initialize conditionally
if (!stripeSecretKey || stripeSecretKey === "YOUR_STRIPE_SECRET_KEY") {
  console.warn(
    "Stripe secret key is not configured. " +
    "Ensure STRIPE_SECRET_KEY in .env (for local) or " +
    "environment variables (for deployed) is set."
  );
  // Do NOT initialize stripe if key is missing, to prevent the error.
  // Subsequent calls to stripe methods will then fail, but with clearer errors.
} else {
  stripe = require("stripe")(stripeSecretKey);
}

const app = express();
const PORT = process.env.PORT || 8080; // Default to 8080 for Cloud Run/local servers

// --- Firebase Admin SDK Initialization ---
try {
  // For standalone Node.js server, initialize with service account key from file path
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;

  if (!serviceAccountPath) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY_PATH is not set in .env");
  }

  // Read the service account JSON file
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("Error initializing Firebase Admin SDK:", error);
  console.error(
    "Ensure FIREBASE_SERVICE_ACCOUNT_KEY_PATH is correctly set in your .env file " +
      "and the JSON file exists and is valid."
  );
  process.exit(1); // Exit if Firebase Admin SDK cannot initialize
}

const db = admin.firestore();

// --- Middleware ---
// CORS for frontend communication.
// Ensure process.env.FRONTEND_URL is correctly set in your .env file
// and as an environment variable for deployment.
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
  })
);
app.use(express.json());

// --- Routes ---

app.get("/", (req, res) => {
  res.send("Stripe Backend is running!");
});

/**
 * Endpoint for reCAPTCHA verification.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @returns {object} JSON response indicating success or failure.
 */
app.post("/verify-recaptcha", async (req, res) => {
  const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

  if (
    !RECAPTCHA_SECRET_KEY ||
    RECAPTCHA_SECRET_KEY === "YOUR_RECAPTCHA_SECRET_KEY"
  ) {
    console.error("reCAPTCHA Secret Key not configured in backend.");
    return res
      .status(500)
      .json({ success: false, error: "Server reCAPTCHA configuration error." });
  }

  const { token } = req.body;

  if (!token) {
    return res
      .status(400)
      .json({ success: false, error: "reCAPTCHA token is missing." });
  }

  try {
    const response = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${RECAPTCHA_SECRET_KEY}&response=${token}`,
      }
    );
    const data = await response.json();
    console.log("reCAPTCHA verification response:", data);

    if (data.success) {
      res.json({ success: true, score: data.score });
    } else {
      res.json({ success: false, error: data["error-codes"] });
    }
  } catch (error) {
    console.error("Error verifying reCAPTCHA:", error);
    res
      .status(500)
      .json({ success: false, error: "Internal server error during " +
        "reCAPTCHA verification." });
  }
});

/**
 * Creates a Stripe Checkout Session.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @returns {object} JSON response with Stripe session ID.
 */
app.post("/create-checkout-session", async (req, res) => {
  // Check if stripe was initialized successfully
  if (!stripe) {
    console.error("Stripe not initialized. Check backend configuration.");
    return res.status(500).json({ error: "Stripe service is not available." });
  }

  const { userId, appId } = req.body;

  if (!userId || !appId) {
    return res.status(400).json({ error: "User ID and App ID are required." });
  }

  try {
    const session = await stripe.checkout.sessions.create({ // Use the global stripe instance
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
      metadata: {
        userId: userId,
        appId: appId,
      },
    });
    res.json({ id: session.id });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Handles Stripe webhook events.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @returns {object} JSON response indicating success.
 */
app.post("/stripe-webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  // Check if stripe was initialized successfully
  if (!stripe) {
    console.error("Stripe not initialized. Check backend configuration.");
    return res.status(500).send("Stripe service is not available.");
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent( // Use the global stripe instance
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
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
 * Handles a completed checkout session to update user's subscription status in Firestore.
 * @param {object} session - The Stripe Checkout Session object.
 */
async function handleCheckoutSessionCompleted(session) {
  const userId = session.metadata.userId;
  const appId = session.metadata.appId;

  if (!userId || !appId) {
    console.error("Error: userId or appId not found in session metadata.");
    return;
  }

  try {
    const subscriptionDocRef = db
      .collection("artifacts")
      .doc(appId)
      .collection("users")
      .doc(userId)
      .collection("subscriptions")
      .doc("status");
    await subscriptionDocRef.set(
      {
        isSubscribed: true,
        paymentStatus: "paid",
        lastPaymentDate: admin.firestore.FieldValue.serverTimestamp(),
        stripeSessionId: session.id,
      },
      { merge: true }
    );
    console.log(
      `User ${userId} subscription status updated to True in Firestore for app ${appId}.`
    );
  } catch (error) {
    console.error(
      `Error updating Firestore for user ${userId} (app ${appId}):`,
      error
    );
  }
}

// Start the server for local development or deployment
app.listen(PORT, () => {
  console.log(`Node.js backend listening on port ${PORT}`);
  console.log(`CORS enabled for: ${process.env.FRONTEND_URL}`);
});
