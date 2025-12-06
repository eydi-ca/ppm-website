// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./src/config/db'); // Import database connection
const upload = require('./src/config/multerConfig');

// Import Routes
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const adminRoutes = require('./src/routes/adminRoutes');

// Import Services
const driveService = require('./src/services/googleDriveService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static Files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// Test Database Connection Route
app.get('/api/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS result');
        res.json({ 
            status: 'success', 
            message: 'Database connected!', 
            result: rows[0].result 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'error', message: 'Database connection failed' });
    }
});

// --- SERVER STARTUP ---
// We use an async function to initialize services before starting the server
(async () => {
    try {
        console.log("🔄 Initializing Google Drive Service...");
        
        // This checks for the drive_token.json file and connects to Drive
        await driveService.initDrive(); 
        
        // Start listening only after Drive is ready
        app.listen(PORT, () => {
            console.log(`✅ Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("❌ Failed to start server:", error.message);
        process.exit(1);
    }
})();