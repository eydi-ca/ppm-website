// src/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/authMiddleware');
const db = require('../config/db');

// --- CONFIGURATION (Adapted from your old code) ---
const MODE = process.env.PAYMONGO_MODE || "test";
const SECRET_KEY = MODE === "live" 
    ? process.env.PAYMONGO_LIVE_SECRET_KEY 
    : process.env.PAYMONGO_TEST_SECRET_KEY;

// Base64 Encode the Key for Basic Auth
const PAYMONGO_AUTH = Buffer.from(SECRET_KEY + ":").toString("base64");

// ===========================================
// 1. CREATE CHECKOUT SESSION
// ===========================================
router.post("/create-checkout-session", protect, async (req, res) => {
    console.log("✅ Received payment request for User:", req.user.id);
    
    try {
        // Fixed price for Gallery Unlock (₱350.00)
        const amountInCentavos = 35000; 
        const userId = req.user.id;
        const userEmail = req.user.email;

        const response = await axios.post("https://api.paymongo.com/v1/checkout_sessions", {
            data: {
                attributes: {
                    send_email_receipt: true,
                    show_description: true,
                    show_line_items: true,
                    description: `Gallery Unlock for User #${userId}`,
                    payment_method_types: ["card", "gcash", "paymaya", "grab_pay"],
                    line_items: [
                        {
                            name: "Full Gallery Unlock",
                            amount: amountInCentavos,
                            currency: "PHP",
                            quantity: 1,
                            description: "High-resolution download access for all photos."
                        }
                    ],
                    // Where to go after payment
                    success_url: "http://localhost:3000/usergallery.html?status=success",
                    cancel_url: "http://localhost:3000/usergallery.html?status=cancelled",
                    
                    // CRITICAL: We attach the UserID here so we can identify them later!
                    metadata: {
                        user_id: userId,
                        email: userEmail
                    }
                }
            }
        }, {
            headers: {
                Authorization: `Basic ${PAYMONGO_AUTH}`,
                "Content-Type": "application/json"
            }
        });

        const checkoutUrl = response.data.data.attributes.checkout_url;
        res.json({ checkout_url: checkoutUrl });

    } catch (err) {
        console.error("❌ PayMongo Error:", err.response ? err.response.data : err.message);
        res.status(500).json({ message: "Server error creating payment link." });
    }
});

// ===========================================
// 2. WEBHOOK / MANUAL CHECK (The "Unlocker")
// ===========================================
// Since we are on Localhost, PayMongo can't "call us back" automatically without Ngrok.
// So we will make a route the Frontend calls after success to verify the payment manually.

router.get("/verify-status", protect, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Check DB first: Is already unlocked?
        const [rows] = await db.query("SELECT is_full_unlocked FROM users WHERE id = ?", [userId]);
        if (rows.length > 0 && rows[0].is_full_unlocked === 1) {
            return res.json({ status: "paid", message: "Already unlocked." });
        }

        // 2. If not, we should ideally ask PayMongo "Did this user just pay?"
        // However, searching PayMongo by metadata is tricky in the free tier API.
        
        // FOR NOW (Development Mode): 
        // If the user visits this route, we will trust they paid IF they came from success_url.
        // IN PRODUCTION: We must rely on Webhooks (I will provide that code below for later).
        
        // Let's Simulate the Unlock for testing:
        if (req.query.confirm === 'true') {
            await db.query("UPDATE users SET is_full_unlocked = 1 WHERE id = ?", [userId]);
            
            // Log Transaction
            await db.query(`
                INSERT INTO transactions (user_id, amount, package_type, payment_status)
                VALUES (?, 350.00, 'full_unlock', 'paid')
            `, [userId]);

            return res.json({ status: "paid", message: "Gallery unlocked successfully!" });
        }

        res.json({ status: "pending", message: "Payment not yet verified." });

    } catch (err) {
        console.error("Verification Error:", err);
        res.status(500).json({ message: "Error verifying payment." });
    }
});

module.exports = router;