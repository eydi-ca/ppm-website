// src/config/multerConfig.js
const multer = require('multer');
const path = require('path');

// 1. Define the absolute path to the 'uploads' folder (starting from the project root)
// This is more reliable than relying solely on __dirname and '..' navigators.
const storagePath = path.join(process.cwd(), 'uploads');

// 2. Define the storage engine
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Use the defined absolute path
        cb(null, storagePath);
    },
    filename: (req, file, cb) => {
        // Keep the original filename for easier tracking before uploading to Drive
        cb(null, file.originalname);
    }
});

// 3. Define the Multer instance using the storage engine
const upload = multer({ storage: storage });

module.exports = upload;