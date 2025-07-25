// functions/index.js (or app.js)
require("dotenv").config(); // LOAD ENVIRONMENT VARIABLES FIRST!

const express = require("express");
const stripe = require("stripe")(
  process.env.STRIPE_SECRET_KEY || functions.config().stripe.secret_key
);
const admin = require("firebase-admin");
const cors = require("cors");
const bodyParser = require("body-parser");
const functions = require("firebase-functions"); // Import firebase-functions

const app = express();
// const PORT = process.env.PORT || 5000; // PORT is not used when deployed as a function

// --- Firebase Admin SDK Initialization ---
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    admin.initializeApp();
  }
  console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("Error initializing Firebase Admin SDK:", error);
  console.error(
    "Ensure FIREBASE_SERVICE_ACCOUNT_KEY_JSON is set for local testing, " +
      "or running in Cloud Functions environment."
  );
}

const db = admin.firestore();

// --- Middleware ---
app.use(
  cors({ origin: process.env.FRONTEND_URL || functions.config().app.frontend_url })
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
  const { token } = req.body;
  const RECAPTCHA_SECRET_KEY =
    process.env.RECAPTCHA_SECRET_KEY || functions.config().recaptcha.secret_key;

  if (!token) {
    return res.status(400).json({ success: false, error: "reCAPTCHA token is missing." });
  }
  if (!RECAPTCHA_SECRET_KEY || RECAPTCHA_SECRET_KEY === "YOUR_RECAPTCHA_SECRET_KEY") {
    console.error("reCAPTCHA Secret Key not configured in backend.");
    return res.status(500).json({ success: false, error: "Server reCAPTCHA configuration error." });
  }

  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${RECAPTCHA_SECRET_KEY}&response=${token}`,
    });
    const data = await response.json();
    console.log("reCAPTCHA verification response:", data);

    if (data.success) {
      res.json({ success: true, score: data.score });
    } else {
      res.json({ success: false, error: data["error-codes"] });
    }
  } catch (error) {
    console.error("Error verifying reCAPTCHA:", error);
    res.status(500).json({ success: false, error: "Internal server error during reCAPTCHA verification." });
  }
});

/**
 * Creates a Stripe Checkout Session.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @returns {object} JSON response with Stripe session ID.
 */
app.post("/create-checkout-session", async (req, res) => {
  const { userId, appId } = req.body;

  if (!userId || !appId) {
    return res.status(400).json({ error: "User ID and App ID are required." });
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
      success_url: `${process.env.FRONTEND_URL || functions.config().app.frontend_url}?success=true`,
      cancel_url: `${process.env.FRONTEND_URL || functions.config().app.frontend_url}?canceled=true`,
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
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || functions.config().stripe.webhook_secret
    );
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": { // Added block scope for const declaration
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
    console.error(`Error updating Firestore for user ${userId} (app ${appId}):`, error);
  }
}

// Export the Express app as an HTTP Cloud Function
exports.api = functions.https.onRequest(app);

// For local development, if not deployed as a function, you can run the app directly
// if (process.env.NODE_ENV !== 'production' && !process.env.FUNCTION_NAME) {
//     app.listen(PORT, () => {
//         console.log(`Node.js backend listening on port ${PORT}`);
//         console.log(`CORS enabled for: ${process.env.FRONTEND_URL}`);
//     });
// }
