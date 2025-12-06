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

router.post('/upload', 
    protect, 
    authorize(['admin', 'staff']), 
    upload.single('customerPhoto'), // Multer processes the form and creates req.file
    async (req, res) => {
        // req.file is created by Multer and holds the temporary file info
        
      console.log('--- RECEIVED BODY ---', req.body); // ADD THIS LINE
      
        try {
            // 1. Check if Multer successfully processed the file
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded or file processing failed.' });
            }

            // 2. Get necessary data from the request body
            const { userID, packageFrame } = req.body; 
            
            // 3. Validate user ID (The check that was failing earlier)
            if (!userID) {
                // IMPORTANT: Clean up the temporary file created by Multer if validation fails
                fs.unlinkSync(req.file.path); 
                return res.status(400).json({ message: 'Missing target user ID.' });
            }
            
            // 4. Create a readable stream from the temporary file path
            // This stream is what the Google Drive API will use to transfer the data
            const fileStream = fs.createReadStream(req.file.path);
            
            // 5. Upload to Google Drive
            // We pass the stream and let the service handle the upload
            const driveFileId = await driveService.uploadFile(
                req.file.originalname, 
                req.file.mimetype, 
                fileStream, 
                null // Passing null means it uses the root folder defined in your .env
            );

            // 6. Save reference to MySQL (linking the Drive ID to the customer)
            const sql = 'INSERT INTO gallery_files (user_id, drive_file_id, filename, package_frame) VALUES (?, ?, ?, ?)';
            await db.query(sql, [userID, driveFileId, req.file.originalname, packageFrame]);

            // 7. Clean up the temporary file on the local server
            // This is essential to prevent your local 'uploads' folder from filling up
            fs.unlinkSync(req.file.path); 

            // 8. Send success response
            res.status(201).json({ 
                message: 'File uploaded and linked successfully.', 
                driveId: driveFileId 
            });

        } catch (error) {
            console.error('Upload Error:', error);
            
            // Critical: Ensure temp file is cleaned up even if the Drive upload or DB query failed
            if(req.file && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            
            res.status(500).json({ message: 'Error processing upload to Drive.', error: error.message });
        }
    }
);

module.exports = router;