-- Database Schema for Battery Notification Service

-- 1. Core Users Table 
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Lock User Mapping 
-- Defines which user has access to which lock
CREATE TABLE IF NOT EXISTS lock_user_mapping (
    mapping_id SERIAL PRIMARY KEY,
    lock_id INTEGER NOT NULL, -- Logical ID, assumes Locks are in DynamoDB/Another DB
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    fcm_id VARCHAR(255), -- FCM Token for Push Notifications
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(lock_id, user_id)
);

-- 3. Notification Campaigns
-- Stores metadata about each weekly campaign run
CREATE TABLE IF NOT EXISTS notification_campaigns (
    campaign_id UUID PRIMARY KEY,
    campaign_type VARCHAR(50) NOT NULL, -- e.g., 'battery_reminder'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    threshold_days INTEGER NOT NULL,
    total_sent INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending' -- pending, running, completed, failed
);

-- 4. Notification Logs
-- Tracks every individual message sent
CREATE TABLE IF NOT EXISTS notification_logs (
    id SERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES notification_campaigns(campaign_id),
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    lock_id INTEGER NOT NULL,
    fcm_id VARCHAR(255) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'sent' -- sent, failed
);

-- 5. Notification Clicks
-- Tracks when a user accepts/clicks a notification
CREATE TABLE IF NOT EXISTS notification_clicks (
    id SERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES notification_campaigns(campaign_id),
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE SET NULL, -- Keep stats even if user deleted? Or CASCADE if strict GDPR.
    clicked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- 6. Battery Check Actions (Conversion)
-- Tracks if the user actually checked the lock status after notification
CREATE TABLE IF NOT EXISTS battery_check_actions (
    id SERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES notification_campaigns(campaign_id),
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    lock_id INTEGER NOT NULL,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    days_after_notification INTEGER
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_logs_campaign ON notification_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_logs_user ON notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_clicks_campaign ON notification_clicks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_actions_campaign ON battery_check_actions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mapping_lock ON lock_user_mapping(lock_id);

-- View for Analytics
CREATE OR REPLACE VIEW campaign_effectiveness AS
SELECT 
    nc.campaign_id,
    nc.campaign_type,
    nc.created_at,
    nc.threshold_days,
    nc.total_sent,
    nc.total_failed,
    COALESCE(click_stats.total_clicks, 0) as total_clicks,
    COALESCE(click_stats.unique_clickers, 0) as unique_clickers,
    COALESCE(action_stats.total_actions, 0) as total_battery_checks,
    COALESCE(action_stats.unique_actors, 0) as unique_battery_checkers,
    CASE 
        WHEN nc.total_sent > 0 THEN 
            ROUND((COALESCE(click_stats.total_clicks, 0)::DECIMAL / nc.total_sent) * 100, 2)
        ELSE 0 
    END as click_through_rate,
    CASE 
        WHEN nc.total_sent > 0 THEN 
            ROUND((COALESCE(action_stats.unique_actors, 0)::DECIMAL / nc.total_sent) * 100, 2)
        ELSE 0 
    END as conversion_rate
FROM notification_campaigns nc
LEFT JOIN (
    SELECT 
        campaign_id,
        COUNT(*) as total_clicks,
        COUNT(DISTINCT user_id) as unique_clickers
    FROM notification_clicks
    GROUP BY campaign_id
) click_stats ON nc.campaign_id = click_stats.campaign_id
LEFT JOIN (
    SELECT 
        campaign_id,
        COUNT(*) as total_actions,
        COUNT(DISTINCT user_id) as unique_actors
    FROM battery_check_actions
    GROUP BY campaign_id
) action_stats ON nc.campaign_id = action_stats.campaign_id;