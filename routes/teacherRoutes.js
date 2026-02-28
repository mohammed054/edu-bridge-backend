const express = require('express');
const router = express.Router();
const { verifyToken, teacherOnly } = require('../middleware/authMiddleware');
const { incidentRateLimiter, messageRateLimiter } = require('../middleware/rateLimitMiddleware');
const {
  getTeacherExams,
  upsertExamMark,
  deleteExamMark,
  listTeacherHomework,
  createHomework,
  updateHomework,
  updateHomeworkAssignment,
  deleteHomework,
  listTeacherAnnouncements,
  createTeacherAnnouncement,
  updateTeacherAnnouncement,
  deleteTeacherAnnouncement,
} = require('../controllers/teacherExamController');
const {
  markAttendance,
  getTeacherAttendanceSummary,
} = require('../controllers/attendanceController');
const {
  listTeacherIncidents,
  logIncident,
  updateIncidentParentStatus,
} = require('../controllers/incidentController');
const {
  getTeacherWeeklySchedule,
  createTeacherScheduleEntry,
  updateTeacherScheduleEntry,
  deleteTeacherScheduleEntry,
} = require('../controllers/scheduleController');
const { getTeacherDashboardInsights } = require('../controllers/intelligenceController');
const {
  previewGradeSheetImport,
  confirmGradeSheetImport,
  generateStudentFeedbackDraft,
  generateStudentTermComment,
} = require('../controllers/teacherAiController');

router.use(verifyToken, teacherOnly);

router.get('/students', getTeacherExams);
router.get('/exams', getTeacherExams);
router.patch('/exams', upsertExamMark);
router.delete('/exams', deleteExamMark);
router.post('/grades/import/preview', messageRateLimiter, previewGradeSheetImport);
router.post('/grades/import/confirm', messageRateLimiter, confirmGradeSheetImport);
router.post('/students/:studentId/feedback-draft', messageRateLimiter, generateStudentFeedbackDraft);
router.post('/students/:studentId/term-comment', messageRateLimiter, generateStudentTermComment);

router.get('/homework', listTeacherHomework);
router.post('/homework', messageRateLimiter, createHomework);
router.patch('/homework/:id', updateHomework);
router.patch('/homework/:id/assignments', updateHomeworkAssignment);
router.delete('/homework/:id', deleteHomework);

router.get('/announcements', listTeacherAnnouncements);
router.post('/announcements', messageRateLimiter, createTeacherAnnouncement);
router.patch('/announcements/:id', updateTeacherAnnouncement);
router.delete('/announcements/:id', deleteTeacherAnnouncement);

router.get('/schedule', getTeacherWeeklySchedule);
router.post('/schedule/entries', createTeacherScheduleEntry);
router.patch('/schedule/entries/:id', updateTeacherScheduleEntry);
router.delete('/schedule/entries/:id', deleteTeacherScheduleEntry);

router.post('/attendance', incidentRateLimiter, markAttendance);
router.get('/attendance/summary', getTeacherAttendanceSummary);

router.get('/incidents', listTeacherIncidents);
router.post('/incidents', incidentRateLimiter, logIncident);
router.patch('/incidents/:id/parent-status', incidentRateLimiter, updateIncidentParentStatus);

router.get('/dashboard-insights', getTeacherDashboardInsights);

module.exports = router;
