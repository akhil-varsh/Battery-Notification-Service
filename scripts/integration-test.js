// Simple Integration Test to verify connectivity to external services
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../src/config/db');
const dynamodb = require('../src/config/dynamodb');
const admin = require('../src/config/firebase');

async function checkIntegrations() {
    console.log('Starting Integration Health Check...\n');
    let success = true;

    // 1. PostgreSQL Check
    try {
        console.log('Testing PostgreSQL connection...');
        const res = await pool.query('SELECT NOW() as now');
        console.log(' PostgreSQL connected successfully');
        console.log(`Server time: ${res.rows[0].now}`);

        // Check for critical tables
        const tables = ['users', 'lock_user_mapping', 'notification_campaigns'];
        for (const table of tables) {
            const tableCheck = await pool.query(`SELECT to_regclass('${table}') as exists`);
            if (tableCheck.rows[0].exists) {
                console.log(`   Table '${table}' exists.`);
            } else {
                console.error(` Table '${table}' DOES NOT EXIST. Run database-schema.sql!`);
                success = false;
            }
        }

    } catch (error) {
        console.error('PostgreSQL connection failed:', error.message);
        success = false;
    }

    // 2. DynamoDB Check
    try {
        console.log('\nTesting DynamoDB connection...');
        const params = {
            TableName: process.env.DYNAMODB_TABLE_NAME,
            Limit: 1
        };
        // Attempt a lightweight scan
        await dynamodb.scan(params).promise();
        console.log(' DynamoDB connection successful (Scan access verified)');
    } catch (error) {
        // Distinguish between auth error and missing table
        if (error.code === 'ResourceNotFoundException') {
            console.error(` DynamoDB Table '${process.env.DYNAMODB_TABLE_NAME}' not found.`);
        } else if (error.code === 'UnrecognizedClientException') {
            console.error(' AWS Credentials invalid or missing.');
        } else {
            console.error(' DynamoDB Check failed:', error.message);
        }
        success = false;
    }

    // 3. Firebase Check
    console.log('\nTesting Firebase configuration...');
    if (admin.apps && admin.apps.length > 0) {
        console.log(' Firebase Admin initialized');
        // We won't send a real message to avoid spam, but the app object exists.
    } else {
        console.error(' Firebase Admin NOT initialized. Check FIREBASE_PRIVATE_KEY_PATH.');
        success = false;
    }

    // Report
    console.log('\n' + '='.repeat(40));
    if (success) {
        console.log(' ALL INTEGRATION CHECKS PASSED');
        process.exit(0);
    } else {
        console.error(' SOME CHECKS FAILED');
        process.exit(1);
    }
}

// Cleanup pool on exit
process.on('exit', () => pool.end());

checkIntegrations();
