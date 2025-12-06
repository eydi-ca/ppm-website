// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');

// Public route (e.g., getting a list of locations)
router.get('/locations', (req, res) => {
    res.json([{ name: 'Suba Sand Dunes' }, { name: 'Chocolate Hills (ATV)' }]);
});

// Protected route: Any logged-in user can view their profile
router.get('/profile', protect, (req, res) => {
    // req.user contains { id, role } from the token
    res.json({ message: `Welcome, ${req.user.role}! This is your protected profile data.`, userId: req.user.id });
});

// Admin ONLY route: Only users with the 'admin' role can access this
router.get('/admin/analytics', protect, authorize(['admin']), (req, res) => {
    res.json({ message: 'Access Granted: Admin Analytics Data', userRole: req.user.role });
});

module.exports = router;