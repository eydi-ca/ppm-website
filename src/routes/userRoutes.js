// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const driveService = require('../services/googleDriveService');
const { protect } = require('../middleware/authMiddleware');
const sharp = require('sharp'); 
const path = require('path');
const archiver = require('archiver');

// Path to your watermark file
const WATERMARK_PATH = path.join(__dirname, '..', '..', 'public', 'watermark.png');

// --- 🔁 WATERMARK UNIT GENERATOR ---
// We store just ONE rotated unit here.
let cachedWatermarkUnit = null;

async function getRotatedWatermarkUnit() {
    // Return cached version if exists
    if (cachedWatermarkUnit) return cachedWatermarkUnit;

    console.log("⚙️ Generating watermark tile cache...");
    try {
        // 1. Create a single rotated unit
        // We resize it to 150px. The rotation adds transparent 'padding' automatically.
        cachedWatermarkUnit = await sharp(WATERMARK_PATH)
            .resize({ width: 150 }) 
            .rotate(-30, { background: { r: 0, g: 0, b: 0, alpha: 0 } }) // Rotate with transparent bg
            .toBuffer();

        console.log("✅ Watermark tile generated.");
        return cachedWatermarkUnit;

    } catch (error) {
        console.error("❌ Failed to generate watermark tile:", error);
        throw error;
    }
}
// ----------------------------------------------

// GET /api/user/gallery
router.get('/gallery', protect, async (req, res) => {
    try {
        const userId = req.user.id;

        // 👇 UPDATED SQL: Joins with unlocked_photos to see what we own
        const sql = `
            SELECT 
                g.drive_file_id, 
                g.filename, 
                g.package_frame, 
                g.upload_date,
                (CASE WHEN u.id IS NOT NULL THEN 1 ELSE 0 END) as is_unlocked_single
            FROM gallery_files g
            LEFT JOIN unlocked_photos u 
                ON g.drive_file_id = u.drive_file_id AND u.user_id = ?
            WHERE g.user_id = ? 
            AND g.visibility_status = 'visible'
            ORDER BY g.upload_date DESC
        `;

        const [files] = await db.query(sql, [userId, userId]);
        res.json(files);
    } catch (error) {
        console.error('Error fetching gallery:', error);
        res.status(500).json({ message: 'Server error fetching gallery.' });
    }
});

// 2. GET /api/user/image/:fileId - Smart Image Stream
router.get('/image/:fileId', protect, async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const userId = req.user.id;
        const mode = req.query.mode || 'preview'; 

        // Security Check
        const [rows] = await db.query(
            'SELECT * FROM gallery_files WHERE drive_file_id = ? AND user_id = ?',
            [fileId, userId]
        );

        if (rows.length === 0) {
            return res.status(403).json({ message: 'Access denied.' });
        }
        
        const filename = rows[0].filename;
        const driveStream = await driveService.getFileStream(fileId);

        if (mode === 'download') {
            // --- DOWNLOAD MODE (Clean) ---
            res.setHeader('Content-Disposition', `attachment; filename="Original_${filename}"`);
            res.setHeader('Content-Type', 'image/jpeg');
            driveStream.pipe(res);

        } else {
            // --- PREVIEW MODE (Tiled) ---
            
            // 1. Get the single rotated unit
            const tileBuffer = await getRotatedWatermarkUnit();

            // 2. Create transform pipeline using 'tile: true'
            const transform = sharp()
                .resize(800) // Resize main photo
                .composite([{ 
                    input: tileBuffer, 
                    tile: true // <--- THE MAGIC FIX: Repeats the pattern automatically
                }])
                .jpeg({ quality: 80 });

            res.setHeader('Content-Type', 'image/jpeg');
            driveStream.pipe(transform).pipe(res);
        }

    } catch (error) {
        console.error('Error streaming image:', error.message);
        res.status(500).json({ message: 'Failed to load image.' });
    }
});

        // GET /api/user/gallery/download-all
        // Zips all visible photos and downloads them
        router.get('/gallery/download-all', protect, async (req, res) => {
            try {
                const userId = req.user.id;

                // 1. SECURITY: Check if user is fully unlocked
                const [userRows] = await db.query('SELECT is_full_unlocked FROM users WHERE id = ?', [userId]);
                if (userRows.length === 0 || userRows[0].is_full_unlocked !== 1) {
                    return res.status(403).json({ message: 'Access denied. You must purchase the full package.' });
                }

                // 2. Get list of all visible files
                const [files] = await db.query(
                    `SELECT drive_file_id, filename 
                    FROM gallery_files 
                    WHERE user_id = ? AND visibility_status = 'visible'`,
                    [userId]
                );

                if (files.length === 0) {
                    return res.status(404).json({ message: 'No photos to download.' });
                }

                // 3. Set Headers for ZIP Download
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="Travel_Memories_${userId}.zip"`);

                // 4. Create Zip Stream
                const archive = archiver('zip', {
                    zlib: { level: 9 } // Maximum compression
                });

                // Pipe archive data to the response (this sends it to the user)
                archive.pipe(res);

                // 5. Add each file from Google Drive to the Zip
                for (const file of files) {
                    try {
                        const stream = await driveService.getFileStream(file.drive_file_id);
                        // Add the file stream to the archive with its name
                        archive.append(stream, { name: file.filename });
                    } catch (err) {
                        console.error(`Failed to zip file ${file.filename}:`, err.message);
                        // Continue zipping other files even if one fails
                    }
                }

                // 6. Finalize (User download starts finishing)
                await archive.finalize();

            } catch (error) {
                console.error('Download All Error:', error);
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Server error creating zip.' });
                }
            }
        });

        // ===========================================
        // POST /api/user/unlock-single
        // Spends 1 Credit to unlock a specific photo
        // ===========================================
        router.post('/unlock-single', protect, async (req, res) => {
            try {
                const userId = req.user.id;
                const { fileId } = req.body;

                if (!fileId) return res.status(400).json({ message: "File ID is required." });

                // 1. Check Credits
                const [user] = await db.query("SELECT credits FROM users WHERE id = ?", [userId]);
                if (user.length === 0 || user[0].credits < 1) {
                    return res.status(400).json({ message: "Not enough credits." });
                }

                // 2. Check if already unlocked
                const [existing] = await db.query("SELECT id FROM unlocked_photos WHERE user_id = ? AND drive_file_id = ?", [userId, fileId]);
                if (existing.length > 0) {
                    return res.json({ message: "Already unlocked." });
                }

                // 3. Deduct Credit & Unlock
                await db.query("UPDATE users SET credits = credits - 1 WHERE id = ?", [userId]);
                await db.query("INSERT INTO unlocked_photos (user_id, drive_file_id) VALUES (?, ?)", [userId, fileId]);

                res.json({ success: true, message: "Photo unlocked!" });

            } catch (error) {
                console.error('Unlock Error:', error); // 👈 This will print the real error in your terminal
                res.status(500).json({ message: 'Server error unlocking photo.' });
            }
        });
        
    

module.exports = router;