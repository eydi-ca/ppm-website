// src/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { protect, authorize } = require('../middleware/authMiddleware');
const upload = require('../config/multerConfig');
const driveService = require('../services/googleDriveService');
const db = require('../config/db');


// ----------------------------------------------------------------------
// FULL ROUTE IMPLEMENTATION
// ----------------------------------------------------------------------
// src/routes/adminRoutes.js

// ... (keep imports) ...

router.post('/upload', protect, authorize(['admin', 'staff']), upload.single('customerPhoto'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });

        const { userID, packageFrame } = req.body;
        if (!userID) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: 'Missing target user ID.' });
        }

        // --- NEW STEP: Get User Email from DB ---
        // We need the email to name the folder in Google Drive
        const [userRows] = await db.query('SELECT email FROM users WHERE id = ?', [userID]);
        
        if (userRows.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'User ID not found in database.' });
        }

        const userEmail = userRows[0].email; // "customer@gmail.com"
        // -----------------------------------------

        const fileStream = fs.createReadStream(req.file.path);
        
        // --- PASS EMAIL TO SERVICE ---
        const driveFileId = await driveService.uploadFile(
            req.file.originalname, 
            req.file.mimetype, 
            fileStream, 
            userEmail // <--- Passing the email here!
        );

        // Database Insert (Unchanged)
        const sql = 'INSERT INTO gallery_files (user_id, drive_file_id, filename, package_frame) VALUES (?, ?, ?, ?)';
        await db.query(sql, [userID, driveFileId, req.file.originalname, packageFrame]);

        fs.unlinkSync(req.file.path); 

        res.status(201).json({ 
            message: 'File uploaded and linked successfully.', 
            driveId: driveFileId 
        });

    } catch (error) {
        console.error('Upload Error:', error);
        if(req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ message: 'Error processing upload.', error: error.message });
    }
});

module.exports = router;