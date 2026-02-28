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
  addSubject,
  updateSubject,
  removeSubject,
  removeTeacher,
  removeStudent,
  removeClass,
  updateTeacherAssignment,
  updateStudentAssignment,
  updateUser,
  setUserStatus,
  resetUserPassword,
  deleteUser,
  listAuditLogs,
} = require('../controllers/adminController');
const {
  getAdminScheduleOverview,
  createAdminScheduleEntry,
  updateAdminScheduleEntry,
  deleteAdminScheduleEntry,
  suggestAdminScheduleSlot,
  copyAdminSchedulePattern,
  previewAdminScheduleImport,
  confirmAdminScheduleImport,
} = require('../controllers/scheduleController');
const {
  getEnterpriseHierarchy,
  getEnterpriseDashboard,
  listEnterpriseStudents,
  bulkUpdateEnterpriseStudents,
  exportEnterpriseStudents,
  listEnterpriseTeachers,
  listEnterpriseClasses,
  getEnterpriseStudentDetail,
  getEnterpriseTeacherDetail,
  getEnterpriseClassDetail,
  updateEnterpriseClassDetail,
  exportClassRoster,
  listSavedViews,
  createSavedView,
  deleteSavedView,
  getSystemContext,
  updateSystemContext,
  getPermissionMatrix,
  updatePermissionMatrix,
  listNotificationWorkflow,
  updateNotificationWorkflow,
  listTicketWorkflow,
  updateTicketWorkflow,
  exportTicketWorkflow,
  listSurveyLifecycle,
  updateSurveyLifecycle,
  exportSurveyRawData,
  getObservabilitySnapshot,
} = require('../controllers/enterpriseController');
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
const { verifyToken, adminOnly, requirePermission } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(verifyToken, adminOnly);

router.get('/overview', listOverview);
router.get('/audit-logs', listAuditLogs);
router.get('/reports', getReports);
router.get('/ai-analytics', getAiAnalytics);
router.get('/intelligence', getAdminIntelligenceOverview);
router.get('/schedule', getAdminScheduleOverview);
router.post('/schedule/entries', createAdminScheduleEntry);
router.patch('/schedule/entries/:id', updateAdminScheduleEntry);
router.delete('/schedule/entries/:id', deleteAdminScheduleEntry);
router.post('/schedule/suggest-slot', suggestAdminScheduleSlot);
router.post('/schedule/pattern-copy', copyAdminSchedulePattern);
router.post('/schedule/import/preview', previewAdminScheduleImport);
router.post('/schedule/import/confirm', confirmAdminScheduleImport);

router.get('/enterprise/hierarchy', requirePermission('dashboard.view'), getEnterpriseHierarchy);
router.get('/enterprise/dashboard', requirePermission('dashboard.view'), getEnterpriseDashboard);

router.get('/enterprise/students', requirePermission('students.view'), listEnterpriseStudents);
router.post('/enterprise/students/bulk-update', requirePermission('students.manage'), bulkUpdateEnterpriseStudents);
router.get('/enterprise/students/export', requirePermission('reports.export'), exportEnterpriseStudents);
router.get('/enterprise/students/:id', requirePermission('students.view'), getEnterpriseStudentDetail);

router.get('/enterprise/teachers', requirePermission('teachers.view'), listEnterpriseTeachers);
router.get('/enterprise/teachers/:id', requirePermission('teachers.view'), getEnterpriseTeacherDetail);

router.get('/enterprise/classes', requirePermission('classes.view'), listEnterpriseClasses);
router.get('/enterprise/classes/:id', requirePermission('classes.view'), getEnterpriseClassDetail);
router.patch('/enterprise/classes/:id', requirePermission('classes.manage'), updateEnterpriseClassDetail);
router.get('/enterprise/classes/:id/roster-export', requirePermission('reports.export'), exportClassRoster);

router.get('/enterprise/views', listSavedViews);
router.post('/enterprise/views', createSavedView);
router.delete('/enterprise/views/:id', deleteSavedView);

router.get('/enterprise/system/context', requirePermission('dashboard.view'), getSystemContext);
router.patch('/enterprise/system/context', requirePermission('dashboard.view'), updateSystemContext);
router.get('/enterprise/system/permissions', requirePermission('dashboard.view'), getPermissionMatrix);
router.patch('/enterprise/system/permissions', requirePermission('dashboard.view'), updatePermissionMatrix);

router.get('/enterprise/notifications/workflow', requirePermission('notifications.view'), listNotificationWorkflow);
router.patch('/enterprise/notifications/workflow/:id', requirePermission('notifications.view'), updateNotificationWorkflow);

router.get('/enterprise/tickets/workflow', requirePermission('tickets.view'), listTicketWorkflow);
router.patch('/enterprise/tickets/workflow/:id', requirePermission('tickets.manage'), updateTicketWorkflow);
router.get('/enterprise/tickets/workflow/export', requirePermission('reports.export'), exportTicketWorkflow);

router.get('/enterprise/surveys/lifecycle', requirePermission('surveys.view'), listSurveyLifecycle);
router.patch('/enterprise/surveys/lifecycle/:id', requirePermission('surveys.manage'), updateSurveyLifecycle);
router.get('/enterprise/surveys/:id/raw-export', requirePermission('reports.export'), exportSurveyRawData);

router.get('/enterprise/observability', requirePermission('dashboard.view'), getObservabilitySnapshot);

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
router.post('/subjects', addSubject);
router.patch('/subjects/:id', updateSubject);
router.delete('/subjects/:id', removeSubject);

router.get('/surveys', listAdminSurveys);
router.post('/surveys', createSurvey);
router.patch('/surveys/:id', updateSurvey);
router.delete('/surveys/:id', deleteSurvey);
router.get('/surveys/:id/responses', listSurveyResponsesForAdmin);

module.exports = router;
