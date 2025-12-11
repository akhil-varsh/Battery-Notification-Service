const { Pool } = require('pg');
require('dotenv').config();

// Initialize PostgreSQL connection
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

class AnalyticsDashboard {
  
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
      WHERE created_at >= CURRENT_DATE - INTERVAL '${weeks} weeks'
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week_start DESC
    `;

    try {
      const result = await pool.query(query);
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

  async generateReport() {
    console.log('='.repeat(60));
    console.log('BATTERY NOTIFICATION CAMPAIGN ANALYTICS REPORT');
    console.log('='.repeat(60));

    try {
      // Overall campaign effectiveness
      const campaigns = await this.getCampaignEffectiveness();
      console.log('\nCAMPAIGN OVERVIEW');
      console.log('-'.repeat(40));
      console.log(`Total Campaigns: ${campaigns.length}`);
      
      if (campaigns.length > 0) {
        const totalSent = campaigns.reduce((sum, c) => sum + c.total_sent, 0);
        const totalClicks = campaigns.reduce((sum, c) => sum + c.total_clicks, 0);
        const totalActions = campaigns.reduce((sum, c) => sum + c.total_battery_checks, 0);
        
        console.log(`Total Notifications Sent: ${totalSent}`);
        console.log(`Total Clicks: ${totalClicks}`);
        console.log(`Total Battery Checks: ${totalActions}`);
        console.log(`Overall Click-Through Rate: ${totalSent > 0 ? ((totalClicks / totalSent) * 100).toFixed(2) : 0}%`);
        console.log(`Overall Conversion Rate: ${totalSent > 0 ? ((totalActions / totalSent) * 100).toFixed(2) : 0}%`);
      }

      // Weekly trends
      const weeklyTrends = await this.getWeeklyTrends();
      console.log('\n WEEKLY TRENDS (Last 8 Weeks)');
      console.log('-'.repeat(40));
      weeklyTrends.forEach(week => {
        const weekStart = new Date(week.week_start).toLocaleDateString();
        console.log(`Week of ${weekStart}:`);
        console.log(`  Campaigns: ${week.campaigns_count}`);
        console.log(`  Notifications: ${week.total_sent || 0}`);
        console.log(`  Clicks: ${week.total_clicks || 0}`);
        console.log(`  Actions: ${week.total_actions || 0}`);
        console.log(`  CTR: ${week.overall_ctr || 0}%`);
        console.log(`  Conversion: ${week.overall_conversion_rate || 0}%`);
        console.log('');
      });

      // User engagement
      const userStats = await this.getUserEngagementStats();
      console.log('\n USER ENGAGEMENT STATISTICS');
      console.log('-'.repeat(40));
      console.log(`Total Users Reached: ${userStats.total_users}`);
      console.log(`Users Who Clicked: ${userStats.users_who_clicked} (${userStats.user_click_rate}%)`);
      console.log(`Users Who Took Action: ${userStats.users_who_acted} (${userStats.user_action_rate}%)`);
      console.log(`Avg Campaigns per User: ${userStats.avg_campaigns_per_user}`);
      console.log(`Avg Clicks per User: ${userStats.avg_clicks_per_user}`);
      console.log(`Avg Actions per User: ${userStats.avg_actions_per_user}`);

      // Response time analysis
      const responseAnalysis = await this.getResponseTimeAnalysis();
      console.log('\n RESPONSE TIME ANALYSIS');
      console.log('-'.repeat(40));
      if (responseAnalysis.length > 0) {
        const avgResponseTime = responseAnalysis.reduce((sum, r) => sum + parseFloat(r.avg_response_days), 0) / responseAnalysis.length;
        const totalResponses = responseAnalysis.reduce((sum, r) => sum + r.total_responses, 0);
        const sameDayResponses = responseAnalysis.reduce((sum, r) => sum + r.same_day_responses, 0);
        const weekResponses = responseAnalysis.reduce((sum, r) => sum + r.week_responses, 0);
        
        console.log(`Average Response Time: ${avgResponseTime.toFixed(2)} days`);
        console.log(`Same-Day Responses: ${sameDayResponses}/${totalResponses} (${((sameDayResponses/totalResponses)*100).toFixed(2)}%)`);
        console.log(`Within-Week Responses: ${weekResponses}/${totalResponses} (${((weekResponses/totalResponses)*100).toFixed(2)}%)`);
      } else {
        console.log('No response data available yet.');
      }

      console.log('\n' + '='.repeat(60));
      console.log('Report generated at:', new Date().toISOString());
      console.log('='.repeat(60));

    } catch (error) {
      console.error('Error generating report:', error);
    }
  }
}

// CLI usage
async function main() {
  const dashboard = new AnalyticsDashboard();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'report':
      await dashboard.generateReport();
      break;
    case 'campaigns':
      const campaigns = await dashboard.getCampaignEffectiveness();
      console.log(JSON.stringify(campaigns, null, 2));
      break;
    case 'trends':
      const trends = await dashboard.getWeeklyTrends();
      console.log(JSON.stringify(trends, null, 2));
      break;
    case 'users':
      const userStats = await dashboard.getUserEngagementStats();
      console.log(JSON.stringify(userStats, null, 2));
      break;
    default:
      console.log('Usage: node analytics-dashboard.js [report|campaigns|trends|users]');
      break;
  }
  
  await pool.end();
}

if (require.main === module) {
  main();
}

module.exports = AnalyticsDashboard;