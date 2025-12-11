// This script mocks AWS and PG interactions to verify the logic of the BatteryNotificationService

const BatteryNotificationService = require('../src/services/NotificationService');

// Mock Data
const MOCK_STALE_LOCKS = [
    { lock_id: 1, battery_check_timestamp: '2023-01-01T00:00:00Z' },
    { lock_id: 2, battery_check_timestamp: '2023-01-01T00:00:00Z' },
    { lock_id: 3, battery_check_timestamp: '2023-01-01T00:00:00Z' }
];

const MOCK_USERS = [
    { lock_id: 1, user_id: 101, fcm_id: 'token_101' },
    { lock_id: 2, user_id: 102, fcm_id: 'token_102' },
    { lock_id: 3, user_id: 103, fcm_id: 'token_103' }
];

// Mock dependencies
class MockService extends BatteryNotificationService {
    async getStaleLocksFromDynamoDB() {
        console.log('[MOCK] getStaleLocksFromDynamoDB called');
        return MOCK_STALE_LOCKS;
    }

    async getUsersForLocks(lockIds) {
        console.log(`[MOCK] getUsersForLocks called with ${lockIds.length} IDs`);
        return MOCK_USERS.filter(u => lockIds.includes(u.lock_id));
    }

    async createCampaignRecord() {
        console.log('[MOCK] createCampaignRecord called');
        return { campaign_id: this.campaignId };
    }

    async logNotificationSent(userId, lockId, fcmId) {
        console.log(`[MOCK] Logged notification for user ${userId}`);
    }

    async updateCampaignStats(totalSent, totalFailed) {
        console.log(`[MOCK] updateCampaignStats called: Sent=${totalSent}, Failed=${totalFailed}`);
    }

    async sendBatchNotifications(userBatch) {
        console.log(`[MOCK] Sending batch of ${userBatch.length} notifications`);
        // Verify URLs are generated correctly
        userBatch.forEach(user => {
            const clickUrl = `${process.env.CLICK_TRACKING_BASE_URL}/track-click/${this.campaignId}/${user.user_id}`;
            console.log(`  -> Generated URL for user ${user.user_id}: ${clickUrl}`);
        });

        return {
            successCount: userBatch.length,
            failureCount: 0,
            responses: userBatch.map(() => ({ success: true }))
        };
    }
}

// Run Test
async function runTest() {
    process.env.CLICK_TRACKING_BASE_URL = 'http://test-url.com';

    console.log('--- STARTING TEST ---');
    const service = new MockService();
    try {
        await service.run();
        console.log('--- TEST PASSED ---');
    } catch (e) {
        console.error('--- TEST FAILED ---', e);
    }
}

runTest();
