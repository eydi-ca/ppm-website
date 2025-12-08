// src/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt'); // Required for creating new users

const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../config/multerConfig');
const driveService = require('../services/googleDriveService');
const db = require('../config/db');

// ----------------------------------------------------------------------
// 1. UPLOAD ROUTE (Modified for Auto-Unlock Logic)
// ----------------------------------------------------------------------
router.post('/upload', protect, authorize(['admin', 'staff']), upload.single('customerPhoto'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

        // Get initialPackage from the request (sent by the frontend)
        const { userID, packageFrame, initialPackage } = req.body;

        if (!userID) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: 'Missing target user ID.' });
        }

        // --- A. Get User Email from DB (For Folder Naming) ---
        const [userRows] = await db.query('SELECT email FROM users WHERE id = ?', [userID]);
        
        if (userRows.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'User ID not found in database.' });
        }

        const userEmail = userRows[0].email;

        // --- B. Upload to Google Drive ---
        const fileStream = fs.createReadStream(req.file.path);
        
        const driveFileId = await driveService.uploadFile(
            req.file.originalname, 
            req.file.mimetype, 
            fileStream, 
            userEmail
        );

        // --- C. Save File Reference to Database ---
        const sql = 'INSERT INTO gallery_files (user_id, drive_file_id, filename, package_frame) VALUES (?, ?, ?, ?)';
        await db.query(sql, [userID, driveFileId, req.file.originalname, packageFrame]);

        // --- D. HANDLE PACKAGE UNLOCKING (New Business Logic) ---
        // If the Admin selected "Premium" during upload, unlock the user immediately.
        if (initialPackage === 'premium') {
            await db.query('UPDATE users SET is_full_unlocked = 1 WHERE id = ?', [userID]);
        }
        // Note: If 'standard', we leave the defaults (locked / 0 credits)

        // --- E. Cleanup ---
        fs.unlinkSync(req.file.path); 

        res.status(201).json({ 
            message: 'File uploaded successfully.', 
            driveId: driveFileId 
        });

    } catch (error) {
        console.error('Upload Error:', error);
        if(req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ message: 'Error processing upload.', error: error.message });
    }
});


// ----------------------------------------------------------------------
// 2. USER MANAGEMENT ROUTES (CRUD)
// ----------------------------------------------------------------------

// GET /api/admin/users - READ All Users
router.get('/users', protect, authorize(['admin', 'staff']), async (req, res) => {
    try {
        // FIXED: Select 'full_name' and alias it as 'name' so frontend code doesn't break
        const [users] = await db.query(`
            SELECT id, full_name AS name, email, role, credits, is_full_unlocked, created_at 
            FROM users 
            ORDER BY FIELD(role, "admin", "staff", "customer"), created_at DESC
        `);
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server error fetching user data.' });
    }
});

// POST /api/admin/users - CREATE New User
router.post('/users', protect, authorize(['admin']), async (req, res) => {
    // FIXED: Use 'full_name' in destructuring logic if needed, but frontend sends 'name'
    const { name, email, password, role } = req.body;
    
    if (!name || !email || !password || !role) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // FIXED: Insert into 'full_name' column
        const [result] = await db.query(
            'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, role]
        );
        
        res.status(201).json({ 
            message: 'User created successfully.', 
            userId: result.insertId 
        });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Email already in use.' });
        }
        console.error('Error creating user:', error);
        res.status(500).json({ message: 'Server error creating user.' });
    }
});

// PUT /api/admin/users/:id - UPDATE User
router.put('/users/:id', protect, authorize(['admin']), async (req, res) => {
    const { name, email, role } = req.body;
    const userId = req.params.id;
    
    try {
        // FIXED: Update 'full_name' column
        await db.query(
            'UPDATE users SET full_name = ?, email = ?, role = ? WHERE id = ?',
            [name, email, role, userId]
        );
        res.json({ message: 'User updated successfully.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Email already in use.' });
        }
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Server error updating user.' });
    }
});

// PUT /api/admin/users/:id/unlock - FORCE UNLOCK (Manual Toggle)
// This allows Admin to unlock a user manually later (e.g. if they paid Cash)
router.put('/users/:id/unlock', protect, authorize(['admin', 'staff']), async (req, res) => {
    const userId = req.params.id;
    const { status } = req.body; // Expects { status: 1 } or { status: 0 }

    try {
        await db.query('UPDATE users SET is_full_unlocked = ? WHERE id = ?', [status, userId]);
        res.json({ message: `User access updated to: ${status ? 'UNLOCKED' : 'LOCKED'}` });
    } catch (error) {
        console.error('Error toggling unlock:', error);
        res.status(500).json({ message: 'Server error updating unlock status.' });
    }
});

module.exports = router;