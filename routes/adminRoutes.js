const express = require('express');
const {
  listOverview,
  getReports,
  getAiAnalytics,
  importUsers,
  exportUsers,
  addTeacher,
  addStudent,
  addClass,
  removeTeacher,
  removeStudent,
  removeClass,
  updateTeacherAssignment,
  updateStudentAssignment,
  updateUser,
  setUserStatus,
  resetUserPassword,
  deleteUser,
} = require('../controllers/adminController');
const { getAdminScheduleOverview } = require('../controllers/scheduleController');
const {
  listAdminIncidents,
  updateIncidentParentStatus,
} = require('../controllers/incidentController');
const { getAdminIntelligenceOverview } = require('../controllers/intelligenceController');
const {
  listAdminSurveys,
  createSurvey,
  updateSurvey,
  deleteSurvey,
  listSurveyResponsesForAdmin,
} = require('../controllers/surveyController');
const { verifyToken, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(verifyToken, adminOnly);

router.get('/overview', listOverview);
router.get('/reports', getReports);
router.get('/ai-analytics', getAiAnalytics);
router.get('/intelligence', getAdminIntelligenceOverview);
router.get('/schedule', getAdminScheduleOverview);
router.get('/incidents', listAdminIncidents);
router.patch('/incidents/:id/parent-status', updateIncidentParentStatus);
router.post('/import-users', importUsers);
router.get('/export-users', exportUsers);

router.post('/teachers', addTeacher);
router.patch('/teachers/:id/assignment', updateTeacherAssignment);
router.delete('/teachers/:id', removeTeacher);

router.post('/students', addStudent);
router.patch('/students/:id/assignment', updateStudentAssignment);
router.delete('/students/:id', removeStudent);

router.patch('/users/:id', updateUser);
router.patch('/users/:id/status', setUserStatus);
router.post('/users/:id/reset-password', resetUserPassword);
router.delete('/users/:id', deleteUser);

router.post('/classes', addClass);
router.delete('/classes/:id', removeClass);

router.get('/surveys', listAdminSurveys);
router.post('/surveys', createSurvey);
router.patch('/surveys/:id', updateSurvey);
router.delete('/surveys/:id', deleteSurvey);
router.get('/surveys/:id/responses', listSurveyResponsesForAdmin);

module.exports = router;
