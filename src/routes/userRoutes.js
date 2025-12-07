// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const driveService = require('../services/googleDriveService');
const { protect } = require('../middleware/authMiddleware');
const sharp = require('sharp'); 
const path = require('path');

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

// 1. GET /api/user/gallery (Unchanged)
router.get('/gallery', protect, async (req, res) => {
    try {
        const [files] = await db.query(
            'SELECT drive_file_id, filename, package_frame, upload_date FROM gallery_files WHERE user_id = ? ORDER BY upload_date DESC', 
            [req.user.id]
        );
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

module.exports = router;