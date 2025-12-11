# Mobile App Integration Guide

This guide details how the mobile application should interact with the Battery Notification Service to support **Click Tracking** and **Conversion Measurement**.

## 1. Deep Link Handling (Click Tracking)

When a user clicks the push notification, they are first directed to our tracking API, which then redirects them to the app.

### Flow:
1.  **Notification Click**: User taps the notification.
2.  **Tracking Request**: Browser/Webview hits: `GET https://our-api.com/track-click/:campaignId/:userId`
3.  **Redirection**: API responds with `302 Redirect` to: `your-app-scheme://battery-check`
4.  **App Open**: Mobile app intercepts the custom scheme and opens the "Battery Status" screen.

### Mobile Requirement:
-   Ensure `AndroidManifest.xml` (Android) and `Info.plist` (iOS) are configured to handle the `your-app-scheme://` deep link schema.

---

## 2. Conversion Tracking (Battery Check Action)

To measure the effectiveness of the campaign (i.e., "Did the user actually check their battery after the notification?"), the mobile app must report this action back to the server.

### When to call:
-   Call this endpoint whenever a user successfully loads the "Battery Status" or "Lock Details" screen.
-   Ideally, cache the `campaignId` from the notification payload if available, or just send the user/lock ID and let the backend attribute it to the latest campaign.

### API Endpoint:
**POST** `/track-battery-check`

### Request Body:
```json
{
  "campaignId": "uuid-string-from-notification-payload",
  "userId": 12345,
  "lockId": 9876
}
```

*Note: If `campaignId` is lost or unavailable on the client side, the backend can be modified to look up the latest active campaign for that user.*

### Example Code (JavaScript/React Native):

```javascript
async function reportBatteryCheck(userId, lockId, campaignId) {
  try {
    const response = await fetch('https://our-api.com/track-battery-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        lockId,
        campaignId // Optional: passed from notification data
      }),
    });
    
    const result = await response.json();
    console.log('Conversion recorded:', result);
  } catch (error) {
    console.error('Failed to report conversion:', error);
  }
}
```

### Backend Logic (How it works):
1.  The backend receives the request.
2.  It looks up the **latest** notification sent to this user for this lock.
3.  It calculates `days_after_notification = Current Date - Notification Sent Date`.
4.  It stores this record in the `battery_check_actions` table.
5.  This data is later used to calculate the **Conversion Rate** and **Response Time** metrics.
