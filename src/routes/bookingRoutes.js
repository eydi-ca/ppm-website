// src/routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const db = require('../config/db');

// CONFIGURATION
const MODE = process.env.PAYMONGO_MODE || "test";
const SECRET_KEY = MODE === "live" ? process.env.PAYMONGO_LIVE_SECRET_KEY : process.env.PAYMONGO_TEST_SECRET_KEY;
const PAYMONGO_AUTH = Buffer.from(SECRET_KEY + ":").toString("base64");

// 1. CREATE BOOKING CHECKOUT
router.post('/create-session', protect, async (req, res) => {
    try {
        const { tourName, date, time, guests, pricePerPax } = req.body;
        const userId = req.user.id;
        const userEmail = req.user.email;

        const totalAmount = pricePerPax * guests;
        const amountInCentavos = Math.round(totalAmount * 100);

        // Dynamic Domain
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const currentDomain = `${protocol}://${host}`; 

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
                        description: `Booking: ${tourName} on ${date}`,
                        payment_method_types: ["card", "gcash", "paymaya", "grab_pay"],
                        line_items: [
                            {
                                name: `${tourName} (${guests} Pax)`,
                                amount: amountInCentavos,
                                currency: "PHP",
                                quantity: 1,
                                description: `Date: ${date} | Time: ${time}`
                            }
                        ],
                        
                        // 👇 FIX: Robust Name Handling
                        billing: {
                            name: (req.user.first_name && req.user.last_name) 
                                ? `${req.user.first_name} ${req.user.last_name}` 
                                : "Valued Customer", // Fallback if names are missing
                            email: userEmail,
                            phone: req.user.phone_number || "09000000000" // Fallback phone
                        },
                        // ----------------------------------
                        success_url: `${currentDomain}/userprofile.html?status=booking_success`,
                        cancel_url: `${currentDomain}/bookings.html?status=cancelled`,
                        metadata: { 
                            user_id: userId,
                            type: 'booking', 
                            tour_name: tourName,
                            booking_date: date,
                            time_slot: time,
                            guest_count: guests
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

        res.json({ checkout_url: data.data.attributes.checkout_url, session_id: data.data.id });

    } catch (error) {
        console.error("Booking Error:", error);
        res.status(500).json({ message: "Server error initiating booking." });
    }
});

// 2. VERIFY BOOKING (Robust Version)
router.get('/verify', protect, async (req, res) => {
    try {
        const sessionId = req.query.session_id;
        if (!sessionId) return res.status(400).json({ message: "No Session ID." });

        console.log(`🔎 Verifying Booking Session: ${sessionId}`);

        const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${sessionId}`, {
            method: "GET",
            headers: { "Authorization": `Basic ${PAYMONGO_AUTH}`, "Accept": "application/json" }
        });
        const data = await response.json();
        
        if (data.errors) {
            console.error("PayMongo Verify Error:", data.errors);
            return res.status(400).json({ message: "Verification failed at gateway." });
        }

        const attributes = data.data.attributes;
        const metadata = attributes.metadata;
        const paymentIntent = attributes.payment_intent;
        
        // 👇 ROBUST CHECK: Check Session Status OR Payment Intent Status
        let isPaid = false;
        let refNum = sessionId;

        if (attributes.payment_status === 'paid') {
            isPaid = true;
        } 
        // Fallback: Sometimes session says 'unpaid' but intent says 'succeeded'
        else if (paymentIntent && paymentIntent.attributes && paymentIntent.attributes.status === 'succeeded') {
            isPaid = true;
            refNum = paymentIntent.id; // Use intent ID as reference if available
        }

        // If payments array exists, prefer that ID
        if (attributes.payments && attributes.payments.length > 0) {
            if (attributes.payments[0].attributes.status === 'paid') {
                isPaid = true;
                refNum = attributes.payments[0].id;
            }
        }

        console.log(`💳 Payment Status: ${isPaid ? 'PAID' : 'PENDING'} | Ref: ${refNum}`);

        if (isPaid && metadata.type === 'booking') {
            const amount = attributes.line_items[0].amount / 100;
            
            // Check duplicate
            const [existing] = await db.query("SELECT id FROM bookings WHERE reference_number = ?", [refNum]);
            
            if (existing.length === 0) {
                console.log("✅ Saving new booking to DB...");
                
                // A. Insert into Bookings
                await db.query(`
                    INSERT INTO bookings (user_id, tour_name, booking_date, time_slot, guest_count, total_amount, payment_status, reference_number)
                    VALUES (?, ?, ?, ?, ?, ?, 'paid', ?)
                `, [metadata.user_id, metadata.tour_name, metadata.booking_date, metadata.time_slot, metadata.guest_count, amount, refNum]);

                // B. Insert into Transactions
                await db.query(`
                    INSERT INTO transactions (user_id, reference_number, amount, package_type, payment_status)
                    VALUES (?, ?, ?, ?, 'paid')
                `, [metadata.user_id, refNum, amount, metadata.tour_name]);

                // C. Auto-Unlock Gallery
                await db.query("UPDATE users SET is_full_unlocked = 1 WHERE id = ?", [metadata.user_id]);
            } else {
                console.log("⚠️ Booking already recorded.");
            }

            return res.json({ status: 'paid', message: 'Booking confirmed & Gallery Unlocked!' });
        }

        // If we reach here, it's not paid
        res.json({ status: 'pending', message: 'Payment status: ' + attributes.payment_status });

    } catch (error) {
        console.error("Verify Error:", error);
        res.status(500).json({ message: "Verification failed on server." });
    }
});

module.exports = router;