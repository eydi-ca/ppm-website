// src/services/cronService.js
const cron = require('node-cron');
const db = require('../config/db');

// Define the "Grim Reaper" Logic
const runCleanupTask = async () => {
    console.log('💀 GRIM REAPER: Checking for expired photos...');

    try {
        // 1. Calculate the date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // Format to MySQL Date string (YYYY-MM-DD)
        const dateString = thirtyDaysAgo.toISOString().split('T')[0];

        // 2. SOFT DELETE (Hide photos older than 30 days)
        // We only update photos that are currently 'visible'
        const [result] = await db.query(
            `UPDATE gallery_files 
             SET visibility_status = 'hidden' 
             WHERE upload_date < ? AND visibility_status = 'visible'`,
            [dateString]
        );

        if (result.affectedRows > 0) {
            console.log(`🔒 GRIM REAPER: Hid ${result.affectedRows} expired photos.`);
        } else {
            console.log('✅ GRIM REAPER: No new photos to expire today.');
        }

    } catch (error) {
        console.error('❌ CRON ERROR:', error);
    }
};

// Schedule the task
// '0 0 * * *' = Run at 00:00 (Midnight) every day
const startCron = () => {
    // Run once immediately on server start (Optional: good for verifying it works)
    runCleanupTask();

    cron.schedule('0 0 * * *', runCleanupTask);
    console.log('🕰️ Daily Cleanup Task Scheduled for Midnight.');
};

module.exports = { startCron };