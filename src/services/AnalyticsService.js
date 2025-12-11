const pool = require('../config/db');

class AnalyticsService {

    async getCampaignEffectiveness(campaignId = null) {
        let query = `
      SELECT 
        campaign_id,
        campaign_type,
        created_at,
        threshold_days,
        total_sent,
        total_failed,
        total_clicks,
        unique_clickers,
        total_battery_checks,
        unique_battery_checkers,
        click_through_rate,
        conversion_rate
      FROM campaign_effectiveness
    `;

        const params = [];
        if (campaignId) {
            query += ' WHERE campaign_id = $1';
            params.push(campaignId);
        }

        query += ' ORDER BY created_at DESC';

        try {
            const result = await pool.query(query, params);
            return result.rows;
        } catch (error) {
            console.error('Error fetching campaign effectiveness:', error);
            throw error;
        }
    }

    async getWeeklyTrends(weeks = 8) {
        const query = `
      SELECT 
        DATE_TRUNC('week', created_at) as week_start,
        COUNT(*) as campaigns_count,
        SUM(total_sent) as total_sent,
        SUM(total_clicks) as total_clicks,
        SUM(total_battery_checks) as total_actions,
        ROUND(AVG(click_through_rate), 2) as avg_ctr,
        ROUND(AVG(conversion_rate), 2) as avg_conversion_rate,
        ROUND(
          CASE 
            WHEN SUM(total_sent) > 0 THEN 
              (SUM(total_clicks)::DECIMAL / SUM(total_sent)) * 100
            ELSE 0 
          END, 2
        ) as overall_ctr,
        ROUND(
          CASE 
            WHEN SUM(total_sent) > 0 THEN 
              (SUM(total_battery_checks)::DECIMAL / SUM(total_sent)) * 100
            ELSE 0 
          END, 2
        ) as overall_conversion_rate
      FROM campaign_effectiveness
    `;
        // Note: The original query had a WHERE clause that might have been missing slightly in my view, but usually correct.
        // Let's add the filter back if it was there or should be.
        // Yes: WHERE created_at >= CURRENT_DATE - INTERVAL '${weeks} weeks'
        // I need to insert it before GROUP BY.
        const fullQuery = `
      SELECT 
        DATE_TRUNC('week', created_at) as week_start,
        COUNT(*) as campaigns_count,
        SUM(total_sent) as total_sent,
        SUM(total_clicks) as total_clicks,
        SUM(total_battery_checks) as total_actions,
        ROUND(AVG(click_through_rate), 2) as avg_ctr,
        ROUND(AVG(conversion_rate), 2) as avg_conversion_rate,
        ROUND(
          CASE 
            WHEN SUM(total_sent) > 0 THEN 
              (SUM(total_clicks)::DECIMAL / SUM(total_sent)) * 100
            ELSE 0 
          END, 2
        ) as overall_ctr,
        ROUND(
          CASE 
            WHEN SUM(total_sent) > 0 THEN 
              (SUM(total_battery_checks)::DECIMAL / SUM(total_sent)) * 100
            ELSE 0 
          END, 2
        ) as overall_conversion_rate
      FROM campaign_effectiveness
      WHERE created_at >= CURRENT_DATE - INTERVAL '${weeks} weeks'
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week_start DESC
    `;

        try {
            const result = await pool.query(fullQuery);
            return result.rows;
        } catch (error) {
            console.error('Error fetching weekly trends:', error);
            throw error;
        }
    }

    async getUserEngagementStats() {
        const query = `
      WITH user_engagement AS (
        SELECT 
          nl.user_id,
          COUNT(DISTINCT nl.campaign_id) as campaigns_received,
          COUNT(DISTINCT nc.campaign_id) as campaigns_clicked,
          COUNT(DISTINCT bca.campaign_id) as campaigns_acted_upon,
          MAX(nl.sent_at) as last_notification_received,
          MAX(nc.clicked_at) as last_click,
          MAX(bca.checked_at) as last_battery_check
        FROM notification_logs nl
        LEFT JOIN notification_clicks nc ON nl.user_id = nc.user_id AND nl.campaign_id = nc.campaign_id
        LEFT JOIN battery_check_actions bca ON nl.user_id = bca.user_id AND nl.campaign_id = bca.campaign_id
        GROUP BY nl.user_id
      )
      SELECT 
        COUNT(*) as total_users,
        ROUND(AVG(campaigns_received), 2) as avg_campaigns_per_user,
        ROUND(AVG(campaigns_clicked), 2) as avg_clicks_per_user,
        ROUND(AVG(campaigns_acted_upon), 2) as avg_actions_per_user,
        COUNT(CASE WHEN campaigns_clicked > 0 THEN 1 END) as users_who_clicked,
        COUNT(CASE WHEN campaigns_acted_upon > 0 THEN 1 END) as users_who_acted,
        ROUND(
          (COUNT(CASE WHEN campaigns_clicked > 0 THEN 1 END)::DECIMAL / COUNT(*)) * 100, 2
        ) as user_click_rate,
        ROUND(
          (COUNT(CASE WHEN campaigns_acted_upon > 0 THEN 1 END)::DECIMAL / COUNT(*)) * 100, 2
        ) as user_action_rate
      FROM user_engagement
    `;

        try {
            const result = await pool.query(query);
            return result.rows[0];
        } catch (error) {
            console.error('Error fetching user engagement stats:', error);
            throw error;
        }
    }

    async getResponseTimeAnalysis() {
        const query = `
      SELECT 
        bca.campaign_id,
        AVG(bca.days_after_notification) as avg_response_days,
        MIN(bca.days_after_notification) as min_response_days,
        MAX(bca.days_after_notification) as max_response_days,
        COUNT(*) as total_responses,
        COUNT(CASE WHEN bca.days_after_notification <= 1 THEN 1 END) as same_day_responses,
        COUNT(CASE WHEN bca.days_after_notification <= 7 THEN 1 END) as week_responses
      FROM battery_check_actions bca
      GROUP BY bca.campaign_id
      ORDER BY avg_response_days ASC
    `;

        try {
            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            console.error('Error fetching response time analysis:', error);
            throw error;
        }
    }
}

module.exports = AnalyticsService;
