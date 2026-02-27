const express = require('express');
const router = express.Router();
const { verifyToken, teacherOnly } = require('../middleware/authMiddleware');
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
const { getTeacherWeeklySchedule } = require('../controllers/scheduleController');
const { getTeacherDashboardInsights } = require('../controllers/intelligenceController');

router.use(verifyToken, teacherOnly);

router.get('/students', getTeacherExams);
router.get('/exams', getTeacherExams);
router.patch('/exams', upsertExamMark);
router.delete('/exams', deleteExamMark);

router.get('/homework', listTeacherHomework);
router.post('/homework', createHomework);
router.patch('/homework/:id', updateHomework);
router.patch('/homework/:id/assignments', updateHomeworkAssignment);
router.delete('/homework/:id', deleteHomework);

router.get('/announcements', listTeacherAnnouncements);
router.post('/announcements', createTeacherAnnouncement);
router.patch('/announcements/:id', updateTeacherAnnouncement);
router.delete('/announcements/:id', deleteTeacherAnnouncement);

router.get('/schedule', getTeacherWeeklySchedule);

router.post('/attendance', markAttendance);
router.get('/attendance/summary', getTeacherAttendanceSummary);

router.get('/incidents', listTeacherIncidents);
router.post('/incidents', logIncident);
router.patch('/incidents/:id/parent-status', updateIncidentParentStatus);

router.get('/dashboard-insights', getTeacherDashboardInsights);

module.exports = router;


