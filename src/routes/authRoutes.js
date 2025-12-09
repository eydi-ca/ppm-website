// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const db = require('../config/db');

// Define the routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// GET /api/auth/me - Get current user status
router.get('/me', protect, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, first_name, last_name, email, role, credits, is_full_unlocked FROM users WHERE id = ?', [req.user.id]);
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;