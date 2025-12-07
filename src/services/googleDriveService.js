// src/services/googleDriveService.js
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(process.cwd(), 'drive_token.json');
const ROOT_FOLDER_NAME = process.env.GDRIVE_ROOT_FOLDER_NAME || 'ProfilePic Multimedia Photos';

let drive = null;
let rootFolderId = null;

// --- Helper: Auth ---
const getAuthClient = () => {
    if (!process.env.GDRIVE_CLIENT_ID || !process.env.GDRIVE_CLIENT_SECRET) {
        throw new Error("Missing GDRIVE credentials in .env");
    }
    return new google.auth.OAuth2(
        process.env.GDRIVE_CLIENT_ID,
        process.env.GDRIVE_CLIENT_SECRET,
        process.env.GDRIVE_REDIRECT_URI
    );
};

// --- Helper: Find or Create a Folder ---
async function findOrCreateFolder(folderName, parentId) {
    // 1. Search for existing folder
    const query = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    
    const res = await drive.files.list({
        q: query,
        fields: 'files(id, name)',
    });

    if (res.data.files.length > 0) {
        // Found it! Return ID.
        return res.data.files[0].id;
    } else {
        // Not found. Create it.
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
        };
        const newFolder = await drive.files.create({
            resource: fileMetadata,
            fields: 'id',
        });
        console.log(`📂 Created Folder: ${folderName} (ID: ${newFolder.data.id})`);
        return newFolder.data.id;
    }
}

// --- Initialization ---
exports.initDrive = async () => {
    if (drive) return; 

    try {
        const tokenContent = fs.readFileSync(TOKEN_PATH);
        const token = JSON.parse(tokenContent);
        
        const auth = getAuthClient();
        auth.setCredentials(token);
        drive = google.drive({ version: 'v3', auth });

        // Find/Create Root Folder
        const res = await drive.files.list({
            q: `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
        });

        if (res.data.files.length > 0) {
            rootFolderId = res.data.files[0].id;
            console.log(`📡 Root Folder Found: ${rootFolderId}`);
        } else {
            const fileMetadata = { name: ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' };
            const newFolder = await drive.files.create({ resource: fileMetadata, fields: 'id' });
            rootFolderId = newFolder.data.id;
            console.log(`📡 Created Root Folder: ${rootFolderId}`);
        }
    } catch (err) {
        console.error("❌ Drive Init Error:", err.message);
        throw err;
    }
};

// --- NEW: Upload with Automatic Folder Hierarchy ---
exports.uploadFile = async (fileName, mimeType, fileStream, userEmail) => {
    if (!drive || !rootFolderId) throw new Error("Google Drive not initialized.");

    // 1. Get Today's Date (YYYY-MM-DD)
    // We use ISO string and split it to get the date part
    const todayDate = new Date().toISOString().split('T')[0]; 

    // 2. Find/Create "Date Folder" inside Root
    const dateFolderId = await findOrCreateFolder(todayDate, rootFolderId);

    // 3. Find/Create "User Email Folder" inside Date Folder
    // We default to 'Unknown_User' if email isn't provided, just to be safe
    const finalFolderName = userEmail || 'Unknown_User';
    const userFolderId = await findOrCreateFolder(finalFolderName, dateFolderId);

    // 4. Upload File into the User's Folder
    const fileMetadata = {
        name: fileName,
        parents: [userFolderId], // <--- Put it here!
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

// --- Get Stream (Unchanged) ---
exports.getFileStream = async (fileId) => {
    const response = await drive.files.get({
        fileId: fileId,
        alt: 'media',
    }, { responseType: 'stream' });
    return response.data;
};