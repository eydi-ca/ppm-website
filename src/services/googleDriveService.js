// src/services/googleDriveService.js (Final OAuth Version)
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Path to the token file you just generated
const TOKEN_PATH = path.join(process.cwd(), 'drive_token.json');

let drive = null;
let rootFolderId = null;

// --- Helper: Get Auth Client ---
const getAuthClient = () => {
    if (!process.env.GDRIVE_CLIENT_ID || !process.env.GDRIVE_CLIENT_SECRET) {
        throw new Error("Missing GDRIVE_CLIENT_ID or CLIENT_SECRET in .env file.");
    }
    return new google.auth.OAuth2(
        process.env.GDRIVE_CLIENT_ID,
        process.env.GDRIVE_CLIENT_SECRET,
        process.env.GDRIVE_REDIRECT_URI
    );
};

// --- Initialization Function ---
exports.initDrive = async () => {
    if (drive) return; 

    // 1. Load the Token
    let token = null;
    try {
        const tokenContent = fs.readFileSync(TOKEN_PATH);
        token = JSON.parse(tokenContent);
    } catch (err) {
        throw new Error('❌ drive_token.json not found. Run the generation script first.');
    }

    // 2. Setup Google Client
    const auth = getAuthClient();
    auth.setCredentials(token);
    drive = google.drive({ version: 'v3', auth });
    
    // 3. Check/Create Root Folder
    const FOLDER_NAME = process.env.GDRIVE_ROOT_FOLDER_NAME || 'ProfilePic Multimedia Photos';
    
    try {
        const res = await drive.files.list({
            q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
        });
        
        if (res.data.files.length > 0) {
            rootFolderId = res.data.files[0].id;
            console.log(`📡 Google Drive Root Folder Found: ${rootFolderId}`);
        } else {
            const fileMetadata = { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' };
            const newFolder = await drive.files.create({ resource: fileMetadata, fields: 'id' });
            rootFolderId = newFolder.data.id;
            console.log(`📡 Created new root folder: ${rootFolderId}`);
        }
    } catch (error) {
        console.error("Failed to connect to Drive:", error.message);
        throw error;
    }
};

// --- Upload Function ---
exports.uploadFile = async (fileName, mimeType, fileStream, parentFolderId) => {
    const finalParentId = parentFolderId || rootFolderId;
    if (!finalParentId) throw new Error("Google Drive not initialized.");
    
    const fileMetadata = {
        name: fileName,
        parents: [finalParentId],
    };
    const media = {
        mimeType: mimeType,
        body: fileStream,
    };

    const file = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id',
    });

    return file.data.id;
};

// --- Get File Stream (For Gallery) ---
exports.getFileStream = async (fileId) => {
    const response = await drive.files.get({
        fileId: fileId,
        alt: 'media',
    }, { responseType: 'stream' });
    
    return response.data;
};