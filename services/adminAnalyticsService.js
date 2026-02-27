const { buildAdminIntelligenceOverview } = require('./intelligenceService');

const buildAdminAiAnalytics = async () => buildAdminIntelligenceOverview();

module.exports = {
  buildAdminAiAnalytics,
};
