const AnalyticsService = require('../services/AnalyticsService');
const pool = require('../config/db');

async function main() {
    const service = new AnalyticsService();

    const command = process.argv[2];

    try {
        switch (command) {
            // Logic for report generation - simplified by copying the logic from original analytics-dashboard.js
            // Since it was printing to console, we can keep it here or move printing logic to service.
            // Keeping it here for now as "presentation layer"
            case 'report':
                await generateConsoleReport(service);
                break;
            case 'campaigns':
                const campaigns = await service.getCampaignEffectiveness();
                console.log(JSON.stringify(campaigns, null, 2));
                break;
            case 'trends':
                const trends = await service.getWeeklyTrends();
                console.log(JSON.stringify(trends, null, 2));
                break;
            case 'users':
                const userStats = await service.getUserEngagementStats();
                console.log(JSON.stringify(userStats, null, 2));
                break;
            default:
                console.log('Usage: node src/jobs/run-analytics.js [report|campaigns|trends|users]');
                break;
        }
    } catch (error) {
        console.error('Error running analytics:', error);
    } finally {
        await pool.end();
    }
}

async function generateConsoleReport(service) {
    console.log('='.repeat(60));
    console.log('BATTERY NOTIFICATION CAMPAIGN ANALYTICS REPORT');
    console.log('='.repeat(60));

    // Overall campaign effectiveness
    const campaigns = await service.getCampaignEffectiveness();
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
    const weeklyTrends = await service.getWeeklyTrends();
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
    const userStats = await service.getUserEngagementStats();
    console.log('\n USER ENGAGEMENT STATISTICS');
    console.log('-'.repeat(40));
    console.log(`Total Users Reached: ${userStats.total_users}`);
    console.log(`Users Who Clicked: ${userStats.users_who_clicked} (${userStats.user_click_rate}%)`);
    console.log(`Users Who Took Action: ${userStats.users_who_acted} (${userStats.user_action_rate}%)`);
    console.log(`Avg Campaigns per User: ${userStats.avg_campaigns_per_user}`);
    console.log(`Avg Clicks per User: ${userStats.avg_clicks_per_user}`);
    console.log(`Avg Actions per User: ${userStats.avg_actions_per_user}`);

    // Response time analysis
    const responseAnalysis = await service.getResponseTimeAnalysis();
    console.log('\n RESPONSE TIME ANALYSIS');
    console.log('-'.repeat(40));
    if (responseAnalysis.length > 0) {
        const avgResponseTime = responseAnalysis.reduce((sum, r) => sum + parseFloat(r.avg_response_days), 0) / responseAnalysis.length;
        const totalResponses = responseAnalysis.reduce((sum, r) => sum + r.total_responses, 0);
        const sameDayResponses = responseAnalysis.reduce((sum, r) => sum + r.same_day_responses, 0);
        const weekResponses = responseAnalysis.reduce((sum, r) => sum + r.week_responses, 0);

        console.log(`Average Response Time: ${avgResponseTime.toFixed(2)} days`);
        console.log(`Same-Day Responses: ${sameDayResponses}/${totalResponses} (${((sameDayResponses / totalResponses) * 100).toFixed(2)}%)`);
        console.log(`Within-Week Responses: ${weekResponses}/${totalResponses} (${((weekResponses / totalResponses) * 100).toFixed(2)}%)`);
    } else {
        console.log('No response data available yet.');
    }

    console.log('\n' + '='.repeat(60));
    console.log('Report generated at:', new Date().toISOString());
    console.log('='.repeat(60));
}

if (require.main === module) {
    main();
}
