const {
  buildAdminIntelligenceOverview,
  buildTeacherDashboardInsights,
} = require('../services/intelligenceService');
const { sendServerError } = require('../utils/safeError');

const getTeacherDashboardInsights = async (req, res) => {
  try {
    const insights = await buildTeacherDashboardInsights(req.user.id);
    return res.json(insights);
  } catch (error) {
    return sendServerError(res, error, 'Failed to load teacher dashboard insights.');
  }
};

const getAdminIntelligenceOverview = async (_req, res) => {
  try {
    const insights = await buildAdminIntelligenceOverview();
    return res.json(insights);
  } catch (error) {
    return sendServerError(res, error, 'Failed to load intelligence overview.');
  }
};

module.exports = {
  getAdminIntelligenceOverview,
  getTeacherDashboardInsights,
};
