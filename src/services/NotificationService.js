const { v4: uuidv4 } = require('uuid');
const dynamodb = require('../config/dynamodb');
const pool = require('../config/db');
const admin = require('../config/firebase');

class BatteryNotificationService {
    constructor() {
        this.thresholdDays = parseInt(process.env.NOTIFICATION_THRESHOLD_DAYS) || 30;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 100;
        this.campaignId = uuidv4();
    }

    async getStaleLocksFromDynamoDB() {
        console.log('Fetching stale locks from DynamoDB...');

        const thresholdTimestamp = new Date();
        thresholdTimestamp.setDate(thresholdTimestamp.getDate() - this.thresholdDays);

        const params = {
            TableName: process.env.DYNAMODB_TABLE_NAME,
            FilterExpression: 'battery_check_timestamp < :threshold',
            ExpressionAttributeValues: {
                ':threshold': thresholdTimestamp.toISOString()
            }
        };

        const staleLocks = [];
        let itemsFetched = 0;
        let lastEvaluatedKey;

        try {
            do {
                if (lastEvaluatedKey) {
                    params.ExclusiveStartKey = lastEvaluatedKey;
                }

                const result = await dynamodb.scan(params).promise();

                if (result.Items) {
                    staleLocks.push(...result.Items);
                    itemsFetched += result.Items.length;
                    console.log(`Scanned batch: Found ${result.Items.length} items (Total: ${itemsFetched})`);
                }

                lastEvaluatedKey = result.LastEvaluatedKey;


            } while (lastEvaluatedKey);

            console.log(`Found total ${staleLocks.length} locks with stale battery data`);
            return staleLocks;
        } catch (error) {
            console.error('Error fetching stale locks:', error);
            throw error;
        }
    }

    async getUsersForLocks(lockIds) {
        console.log(`Fetching users for ${lockIds.length} locks...`);

        // Batch size for Postgres queries to avoid parameter limits
        const BATCH_SIZE = 1000;
        const allUsers = [];

        for (let i = 0; i < lockIds.length; i += BATCH_SIZE) {
            const batchLockIds = lockIds.slice(i, i + BATCH_SIZE);
            const placeholders = batchLockIds.map((_, index) => `$${index + 1}`).join(',');

            const query = `
        SELECT lock_id, user_id, fcm_id 
        FROM lock_user_mapping 
        WHERE lock_id IN (${placeholders}) 
        AND fcm_id IS NOT NULL
      `;

            try {
                const result = await pool.query(query, batchLockIds);
                allUsers.push(...result.rows);
            } catch (error) {
                console.error(`Error fetching users for batch ${i}-${i + BATCH_SIZE}:`, error);
                throw error;
            }
        }

        console.log(`Found ${allUsers.length} users with valid FCM tokens`);
        return allUsers;
    }

    async createCampaignRecord() {
        const query = `
      INSERT INTO notification_campaigns (
        campaign_id, 
        campaign_type, 
        created_at, 
        threshold_days,
        status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

        const values = [
            this.campaignId,
            'battery_reminder',
            new Date(),
            this.thresholdDays,
            'running'
        ];

        try {
            const result = await pool.query(query, values);
            console.log(`Created campaign record: ${this.campaignId}`);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating campaign record:', error);
            throw error;
        }
    }

    async logNotificationSent(userId, lockId, fcmId) {
        const query = `
      INSERT INTO notification_logs (
        campaign_id,
        user_id,
        lock_id,
        fcm_id,
        sent_at,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `;

        const values = [
            this.campaignId,
            userId,
            lockId,
            fcmId,
            new Date(),
            'sent'
        ];

        try {
            await pool.query(query, values);
        } catch (error) {
            console.error('Error logging notification:', error);
        }
    }

    async sendBatchNotifications(userBatch) {
        const messages = userBatch.map(user => ({
            token: user.fcm_id,
            notification: {
                title: 'Battery Check Reminder',
                body: `Your lock hasn't been checked in ${this.thresholdDays} days. Please check your battery level.`
            },
            data: {
                type: 'battery_reminder',
                lock_id: user.lock_id.toString(),
                campaign_id: this.campaignId,
                click_tracking_url: `${process.env.CLICK_TRACKING_BASE_URL}/track-click/${this.campaignId}/${user.user_id}`
            },
            android: {
                priority: 'high',
                notification: {
                    icon: 'battery_alert',
                    color: '#FF6B35'
                }
            },
            apns: {
                payload: {
                    aps: {
                        badge: 1,
                        sound: 'default'
                    }
                }
            }
        }));

        try {
            const response = await admin.messaging().sendAll(messages);

            // Log successful notifications
            for (let i = 0; i < response.responses.length; i++) {
                const user = userBatch[i];
                if (response.responses[i].success) {
                    await this.logNotificationSent(user.user_id, user.lock_id, user.fcm_id);
                } else {
                    console.error(`Failed to send to user ${user.user_id}:`, response.responses[i].error);
                }
            }

            console.log(`Batch sent: ${response.successCount} successful, ${response.failureCount} failed`);
            return response;
        } catch (error) {
            console.error('Error sending batch notifications:', error);
            throw error;
        }
    }

    async updateCampaignStats(totalSent, totalFailed) {
        const query = `
      UPDATE notification_campaigns 
      SET 
        total_sent = $1,
        total_failed = $2,
        completed_at = $3,
        status = $4
      WHERE campaign_id = $5
    `;

        const values = [totalSent, totalFailed, new Date(), 'completed', this.campaignId];

        try {
            await pool.query(query, values);
            console.log(`Updated campaign stats: ${totalSent} sent, ${totalFailed} failed`);
        } catch (error) {
            console.error('Error updating campaign stats:', error);
        }
    }

    async processBatches(users) {
        let totalSent = 0;
        let totalFailed = 0;

        for (let i = 0; i < users.length; i += this.batchSize) {
            const batch = users.slice(i, i + this.batchSize);
            console.log(`Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(users.length / this.batchSize)}`);

            try {
                const response = await this.sendBatchNotifications(batch);
                totalSent += response.successCount;
                totalFailed += response.failureCount;

                // Add delay between batches to avoid rate limiting
                if (i + this.batchSize < users.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.error(`Error processing batch starting at index ${i}:`, error);
                totalFailed += batch.length;
            }
        }

        return { totalSent, totalFailed };
    }

    async run() {
        console.log(`Starting battery notification campaign: ${this.campaignId}`);
        console.log(`Threshold: ${this.thresholdDays} days`);

        try {
            // Create campaign record
            await this.createCampaignRecord();

            // Get stale locks from DynamoDB
            const staleLocks = await this.getStaleLocksFromDynamoDB();

            if (staleLocks.length === 0) {
                console.log('No stale locks found. Campaign completed.');
                await this.updateCampaignStats(0, 0);
                return;
            }

            // Get users for these locks
            const lockIds = staleLocks.map(lock => lock.lock_id);
            const users = await this.getUsersForLocks(lockIds);

            if (users.length === 0) {
                console.log('No users with valid FCM tokens found. Campaign completed.');
                await this.updateCampaignStats(0, 0);
                return;
            }

            // Send notifications in batches
            const { totalSent, totalFailed } = await this.processBatches(users);

            // Update campaign statistics
            await this.updateCampaignStats(totalSent, totalFailed);

            console.log(`Campaign ${this.campaignId} completed successfully!`);
            console.log(`Total notifications sent: ${totalSent}`);
            console.log(`Total failures: ${totalFailed}`);

        } catch (error) {
            console.error('Campaign failed:', error);
            await this.updateCampaignStats(0, 0);
            throw error;
        }
    }
}

module.exports = BatteryNotificationService;
