// index.js (or app.js)
require('dotenv').config(); // LOAD ENVIRONMENT VARIABLES FIRST!

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');
const cors = require('cors');
const bodyParser = require('body-parser'); // For parsing raw body for webhooks

const app = express();
const PORT = process.env.PORT || 5000;

// --- Firebase Admin SDK Initialization ---
// IMPORTANT: Load your Firebase service account key securely.
// In production, use environment variables. For local testing, ensure .env is configured.
try {
    // Use the service account file path from environment variable
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
    if (!serviceAccountPath) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY_PATH environment variable is not set');
    }
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath)
    });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("Error initializing Firebase Admin SDK:", error);
    console.error("Please ensure FIREBASE_SERVICE_ACCOUNT_KEY_PATH is correctly set in your .env file and points to a valid Firebase service account JSON file.");
    // Exit if Firebase initialization fails (critical for app function)
    process.exit(1);
}

const db = admin.firestore();

// --- Middleware ---
// CORS for frontend communication
// Ensure process.env.FRONTEND_URL is correctly set in your .env file
app.use(cors({ origin: process.env.FRONTEND_URL }));

// For JSON body parsing (for /create-checkout-session)
app.use(express.json());

// --- Routes ---

app.get('/', (req, res) => {
    res.send('Stripe Backend is running!');
});

app.post('/create-checkout-session', async (req, res) => {
    const { userId, appId } = req.body;

    if (!userId || !appId) {
        return res.status(400).json({ error: 'User ID and App ID are required.' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'Premium Content Subscription',
                            description: 'Access to exclusive gated content',
                        },
                        unit_amount: 2000, // $20.00 (amount in cents)
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment', // Use 'subscription' for recurring payments if needed
            success_url: `${process.env.FRONTEND_URL}?success=true`,
            cancel_url: `${process.env.FRONTEND_URL}?canceled=true`,
            metadata: {
                userId: userId,
                appId: appId,
            },
        });
        res.json({ id: session.id });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stripe Webhook endpoint (must use raw body for signature verification)
app.post('/stripe-webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // Ensure process.env.STRIPE_WEBHOOK_SECRET is correctly set in your .env file
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log(`Checkout session completed for session ID: ${session.id}`);
            // Fulfill the purchase in your database
            await handleCheckoutSessionCompleted(session);
            break;
        // Add other event types you want to handle (e.g., 'customer.subscription.deleted')
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    // Return a 200 response to acknowledge receipt of the event
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
        const subscriptionDocRef = db.collection('artifacts').doc(appId).collection('users').doc(userId).collection('subscriptions').doc('status');
        await subscriptionDocRef.set({
            isSubscribed: true,
            paymentStatus: 'paid',
            lastPaymentDate: admin.firestore.FieldValue.serverTimestamp(),
            stripeSessionId: session.id,
            // You can store more details from the session if needed
        }, { merge: true });
        console.log(`User ${userId} subscription status updated to True in Firestore for app ${appId}.`);
    } catch (error) {
        console.error(`Error updating Firestore for user ${userId} (app ${appId}):`, error);
    }
}

// Start the server
app.listen(PORT, () => {
    console.log(`Node.js backend listening on port ${PORT}`);
    console.log(`CORS enabled for: ${process.env.FRONTEND_URL}`);
});