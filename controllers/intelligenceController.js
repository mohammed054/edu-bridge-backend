const {
  buildAdminIntelligenceOverview,
  buildTeacherDashboardInsights,
} = require('../services/intelligenceService');

const getTeacherDashboardInsights = async (req, res) => {
  try {
    const insights = await buildTeacherDashboardInsights(req.user.id);
    return res.json(insights);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load teacher dashboard insights.' });
  }
};

const getAdminIntelligenceOverview = async (_req, res) => {
  try {
    const insights = await buildAdminIntelligenceOverview();
    return res.json(insights);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load intelligence overview.' });
  }
};

module.exports = {
  getAdminIntelligenceOverview,
  getTeacherDashboardInsights,
};
