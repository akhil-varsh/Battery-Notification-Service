require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccountPath = process.env.FIREBASE_PRIVATE_KEY_PATH;
let firebaseApp;

try {
    if (serviceAccountPath && !serviceAccountPath.startsWith('MOCK')) {
        const serviceAccount = require(`../../${serviceAccountPath}`);    
        const path = require('path');
        const absolutePath = path.resolve(process.cwd(), serviceAccountPath);

        admin.initializeApp({
            credential: admin.credential.cert(require(absolutePath)),
            projectId: process.env.FIREBASE_PROJECT_ID
        });
        console.log('Firebase initialized successfully.');
    } else {
        console.warn('Warning: FIREBASE_PRIVATE_KEY_PATH not valid or missing. Notification sending will be mocked or fail.');
    }
} catch (error) {
    console.warn(`Warning: Could not load Firebase credentials.`, error.message);
}

module.exports = admin;
