-- Create tables for tracking notification campaigns and effectiveness

-- Table to track notification campaigns
CREATE TABLE IF NOT EXISTS notification_campaigns (
    campaign_id UUID PRIMARY KEY,
    campaign_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    threshold_days INTEGER NOT NULL,
    total_sent INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending' -- pending, running, completed, failed
);

-- Table to log individual notifications
CREATE TABLE IF NOT EXISTS notification_logs (
    id SERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES notification_campaigns(campaign_id),
    user_id INTEGER NOT NULL,
    lock_id INTEGER NOT NULL,
    fcm_id VARCHAR(255) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'sent' -- sent, failed, clicked
);

-- Table to track notification clicks
CREATE TABLE IF NOT EXISTS notification_clicks (
    id SERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES notification_campaigns(campaign_id),
    user_id INTEGER NOT NULL,
    clicked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- Table to track battery check actions after notifications
CREATE TABLE IF NOT EXISTS battery_check_actions (
    id SERIAL PRIMARY KEY,
    campaign_id UUID REFERENCES notification_campaigns(campaign_id),
    user_id INTEGER NOT NULL,
    lock_id INTEGER NOT NULL,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    days_after_notification INTEGER
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notification_logs_campaign_id ON notification_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id ON notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_clicks_campaign_id ON notification_clicks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_battery_check_actions_campaign_id ON battery_check_actions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON notification_campaigns(created_at);

-- View for campaign effectiveness analysis
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