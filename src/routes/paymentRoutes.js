// src/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const db = require('../config/db');

// CONFIGURATION
const MODE = process.env.PAYMONGO_MODE || "test";
const SECRET_KEY = MODE === "live" 
    ? process.env.PAYMONGO_LIVE_SECRET_KEY 
    : process.env.PAYMONGO_TEST_SECRET_KEY;
const PAYMONGO_AUTH = Buffer.from(SECRET_KEY + ":").toString("base64");

// 1. CREATE CHECKOUT SESSION
router.post("/create-checkout-session", protect, async (req, res) => {
    try {
        // Detect Domain (Localhost vs Ngrok)
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const currentDomain = `${protocol}://${host}`; 

        const userId = req.user.id;
        const userEmail = req.user.email;
        const packageType = req.body.packageType || 'full_unlock'; // Default

        // 👇 DEFINE PRICES & LOGIC
        let amountInCentavos = 35000;
        let description = "Full Gallery Unlock";
        let productName = "Premium Package (Unlimited)";

        if (packageType === '5_credits') {
            amountInCentavos = 15000; // ₱150.00
            description = "5 Photo Downloads Credit";
            productName = "Starter Package (5 Photos)";
        } else if (packageType === '10_credits') {
            amountInCentavos = 25000; // ₱250.00
            description = "10 Photo Downloads Credit";
            productName = "Standard Package (10 Photos)";
        }

        // Call PayMongo
        const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
            method: "POST",
            headers: {
                "Authorization": `Basic ${PAYMONGO_AUTH}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                data: {
                    attributes: {
                        send_email_receipt: true,
                        show_description: true,
                        show_line_items: true,
                        description: `User #${userId}: ${productName}`,
                        payment_method_types: ["card", "gcash", "paymaya", "grab_pay"],
                        line_items: [
                            {
                                name: productName,
                                amount: amountInCentavos,
                                currency: "PHP",
                                quantity: 1,
                                description: description
                            }
                        ],
                        // Redirect back to profile to run verification
                        success_url: `${currentDomain}/userprofile.html?status=success`,
                        cancel_url: `${currentDomain}/package.html?status=cancelled`,
                        metadata: { 
                            user_id: userId, 
                            email: userEmail,
                            package_type: packageType // 👈 IMPORTANT: We save what they bought
                        }
                    }
                }
            })
        });

        const data = await response.json();

        if (data.errors) {
            console.error("PayMongo Error:", data.errors);
            return res.status(400).json({ message: "Payment Gateway Error" });
        }

        res.json({ 
            checkout_url: data.data.attributes.checkout_url,
            session_id: data.data.id 
        });

    } catch (err) {
        console.error("Server Error:", err);
        res.status(500).json({ message: "Server error creating payment link." });
    }
});

// 2. VERIFY STATUS
router.get("/verify-status", protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const sessionId = req.query.cs_id; 

        if (!sessionId) return res.status(400).json({ message: "No Session ID." });

        console.log(`🔎 Verifying Session: ${sessionId}`);

        // Get details from PayMongo
        const pmResponse = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${sessionId}`, {
            method: "GET",
            headers: { "Authorization": `Basic ${PAYMONGO_AUTH}`, "Accept": "application/json" }
        });
        
        const pmData = await pmResponse.json();

        if (pmData.errors) return res.status(400).json({ message: "Verification failed." });

        const attributes = pmData.data.attributes;
        const payments = attributes.payments || [];
        const paymentIntent = attributes.payment_intent;

        // Check if Paid
        let isPaid = false;
        let realReferenceNumber = sessionId;
        
        if (payments.length > 0 && payments[0].attributes.status === 'paid') {
            isPaid = true;
            realReferenceNumber = payments[0].id;
        } else if (paymentIntent && paymentIntent.attributes && paymentIntent.attributes.status === 'succeeded') {
            isPaid = true;
            realReferenceNumber = paymentIntent.id;
        }

        if (isPaid) {
            // 👇 LOGIC: Grant Rewards based on Metadata
            const metadata = attributes.metadata || {};
            const purchasedPackage = metadata.package_type || 'full_unlock';
            const amountPaid = attributes.line_items[0].amount / 100;

            console.log(`🎁 Granting Reward: ${purchasedPackage}`);

            if (purchasedPackage === 'full_unlock') {
                await db.query("UPDATE users SET is_full_unlocked = 1 WHERE id = ?", [userId]);
            } 
            else if (purchasedPackage === '5_credits') {
                await db.query("UPDATE users SET credits = credits + 5 WHERE id = ?", [userId]);
            }
            else if (purchasedPackage === '10_credits') {
                await db.query("UPDATE users SET credits = credits + 10 WHERE id = ?", [userId]);
            }

            // Save Transaction
            const [existing] = await db.query("SELECT id FROM transactions WHERE reference_number = ?", [realReferenceNumber]);
            if (existing.length === 0) {
                await db.query(`
                    INSERT INTO transactions (user_id, reference_number, amount, package_type, payment_status)
                    VALUES (?, ?, ?, ?, 'paid')
                `, [userId, realReferenceNumber, amountPaid, purchasedPackage]);
            }

            return res.json({ status: "paid", message: "Package unlocked!" });
        } else {
            return res.json({ status: "pending", message: "Payment incomplete." });
        }

    } catch (err) {
        console.error("Verification Error:", err);
        res.status(500).json({ message: "Error verifying payment." });
    }
});

// POST /api/user/unlock-single
// Spends 1 Credit to unlock a specific photo
router.post('/unlock-single', protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const { fileId } = req.body;

        // 1. Check Credits
        const [user] = await db.query("SELECT credits FROM users WHERE id = ?", [userId]);
        if (user.length === 0 || user[0].credits < 1) {
            return res.status(400).json({ message: "Not enough credits." });
        }

        // 2. Check if already unlocked (Don't charge twice)
        const [existing] = await db.query("SELECT id FROM unlocked_photos WHERE user_id = ? AND drive_file_id = ?", [userId, fileId]);
        if (existing.length > 0) {
            return res.json({ message: "Already unlocked." });
        }

        // 3. Deduct Credit & Unlock
        await db.query("UPDATE users SET credits = credits - 1 WHERE id = ?", [userId]);
        await db.query("INSERT INTO unlocked_photos (user_id, drive_file_id) VALUES (?, ?)", [userId, fileId]);

        res.json({ success: true, message: "Photo unlocked!" });

    } catch (error) {
        console.error('Unlock Error:', error);
        res.status(500).json({ message: 'Server error unlocking photo.' });
    }
});

module.exports = router;