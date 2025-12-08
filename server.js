require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./src/config/db'); // Your Promise-based connection
const upload = require('./src/config/multerConfig');
const { startCron } = require('./src/services/cronService');

// Import Routes
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');

const driveService = require('./src/services/googleDriveService');

// 1. INITIALIZE APP
const app = express();
const PORT = process.env.PORT || 3000;

// 2. MIDDLEWARE
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. STATIC FILES
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 4. SEARCH USER BY EMAIL (FIXED: ASYNC/AWAIT)
// ==========================================
app.get('/api/users/find', async (req, res) => {
    const email = req.query.email;
    
    console.log("------------------------------------------------");
    console.log("🔍 SEARCH REQUEST RECEIVED for:", email);

    if (!email) {
        return res.status(400).json({ message: "Email is required" });
    }

    try {
        const sql = "SELECT * FROM users WHERE email = ?";
        
        // IMPORTANT: We use 'await' and destructure [rows] because your DB is Promise-based
        const [rows] = await db.query(sql, [email]);

        console.log("✅ DATABASE RESULT:", rows);

        if (rows.length > 0) {
            const user = rows[0];
            console.log("👉 FOUND ID:", user.id); 
            res.json({ id: user.id }); 
        } else {
            console.log("❌ USER NOT FOUND IN DB");
            res.status(404).json({ message: "User not found" });
        }
    } catch (err) {
        console.error("❌ DATABASE ERROR:", err);
        res.status(500).json({ message: "Database error" });
    }
});

// 5. OTHER ROUTES
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payment', paymentRoutes);

// Test DB Route (Matches the style above)
app.get('/api/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS result');
        res.json({ status: 'success', message: 'Database connected!', result: rows[0].result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Database connection failed' });
    }
});

// 6. SERVER STARTUP
(async () => {
    try {
        console.log("🔄 Initializing Google Drive Service...");
        try { await driveService.initDrive(); } catch (e) { console.warn("Drive Init Skipped"); }
        
        startCron();
        
        app.listen(PORT, () => {
            console.log(`✅ Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("❌ Failed to start server:", error.message);
        process.exit(1);
    }
})();