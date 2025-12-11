const BatteryNotificationService = require('../services/NotificationService');
const pool = require('../config/db');

async function main() {
    const service = new BatteryNotificationService();

    try {
        await service.run();
        console.log('Battery notification service completed successfully');
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('Service failed:', error);
        await pool.end();
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT, closing connections...');
    await pool.end();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, closing connections...');
    await pool.end();
    process.exit(0);
});

if (require.main === module) {
    main();
}
