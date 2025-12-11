const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize PostgreSQL connection
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());

// Middleware to get client IP
const getClientIP = (req) => {
  return req.headers['x-forwarded-for'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    (req.connection.socket ? req.connection.socket.remoteAddress : null);
};

// Click tracking endpoint
app.get('/track-click/:campaignId/:userId', async (req, res) => {
  const { campaignId, userId } = req.params;
  const ipAddress = getClientIP(req);
  const userAgent = req.headers['user-agent'];

  try {
    // Log the click
    const query = `
      INSERT INTO notification_clicks (campaign_id, user_id, ip_address, user_agent)
      VALUES ($1, $2, $3, $4)
    `;

    await pool.query(query, [campaignId, parseInt(userId), ipAddress, userAgent]);

    console.log(`Click tracked: Campaign ${campaignId}, User ${userId}`);

    // Redirect to app or show a message
    const deepLinkScheme = process.env.DEEP_LINK_SCHEME || 'your-app-scheme://';
    res.redirect(`${deepLinkScheme}battery-check`);

  } catch (error) {
    console.error('Error tracking click:', error);
    res.status(500).json({ error: 'Failed to track click' });
  }
});

// API endpoint to record battery check actions
app.post('/track-battery-check', async (req, res) => {
  const { campaignId, userId, lockId } = req.body;

  if (!campaignId || !userId || !lockId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    // Calculate days since notification was sent
    const notificationQuery = `
      SELECT sent_at 
      FROM notification_logs 
      WHERE campaign_id = $1 AND user_id = $2 AND lock_id = $3
      ORDER BY sent_at DESC 
      LIMIT 1
    `;

    const notificationResult = await pool.query(notificationQuery, [campaignId, userId, lockId]);

    if (notificationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const sentAt = new Date(notificationResult.rows[0].sent_at);
    const now = new Date();
    const daysAfterNotification = Math.floor((now - sentAt) / (1000 * 60 * 60 * 24));

    // Record the battery check action
    const insertQuery = `
      INSERT INTO battery_check_actions (campaign_id, user_id, lock_id, days_after_notification)
      VALUES ($1, $2, $3, $4)
    `;

    await pool.query(insertQuery, [campaignId, userId, lockId, daysAfterNotification]);

    console.log(`Battery check tracked: Campaign ${campaignId}, User ${userId}, Lock ${lockId}`);

    res.json({
      success: true,
      message: 'Battery check action recorded',
      daysAfterNotification
    });

  } catch (error) {
    console.error('Error tracking battery check:', error);
    res.status(500).json({ error: 'Failed to track battery check' });
  }
});

// API endpoint to get campaign statistics
app.get('/campaign-stats/:campaignId', async (req, res) => {
  const { campaignId } = req.params;

  try {
    const query = `
      SELECT * FROM campaign_effectiveness 
      WHERE campaign_id = $1
    `;

    const result = await pool.query(query, [campaignId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching campaign stats:', error);
    res.status(500).json({ error: 'Failed to fetch campaign stats' });
  }
});

// API endpoint to get weekly campaign summary
app.get('/weekly-summary', async (req, res) => {
  try {
    const query = `
      SELECT 
        DATE_TRUNC('week', created_at) as week_start,
        COUNT(*) as total_campaigns,
        SUM(total_sent) as total_notifications_sent,
        SUM(total_clicks) as total_clicks,
        SUM(unique_clickers) as total_unique_clickers,
        SUM(total_battery_checks) as total_battery_checks,
        AVG(click_through_rate) as avg_click_through_rate,
        AVG(conversion_rate) as avg_conversion_rate
      FROM campaign_effectiveness
      WHERE created_at >= CURRENT_DATE - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week_start DESC
    `;

    const result = await pool.query(query);
    res.json(result.rows);

  } catch (error) {
    console.error('Error fetching weekly summary:', error);
    res.status(500).json({ error: 'Failed to fetch weekly summary' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Click tracking API running on port ${port}`);
});

module.exports = app;