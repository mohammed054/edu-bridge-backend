const express = require('express');
const router = express.Router();
const { verifyToken, studentOnly } = require('../middleware/authMiddleware');
const { messageRateLimiter } = require('../middleware/rateLimitMiddleware');
const { getStudentProfile } = require('../controllers/profileController');
const { getStudentPortalData } = require('../controllers/studentPortalController');
const { getStudentWeeklySchedule } = require('../controllers/scheduleController');
const { getStudentAttendanceSummary } = require('../controllers/attendanceController');
const {
  submitStudentToTeacherFeedback,
  submitStudentToAdminFeedback,
  listFeedbacks,
} = require('../controllers/feedbackController');

router.use(verifyToken, studentOnly);

router.get('/portal', getStudentPortalData);
router.get('/schedule', getStudentWeeklySchedule);
router.get('/attendance/summary', getStudentAttendanceSummary);

router.get('/profile', (req, res, next) => {
  req.params.studentId = req.user.id;
  return getStudentProfile(req, res, next);
});

router.get('/feedback', (req, res, next) => {
  req.query.studentId = req.user.id;
  return listFeedbacks(req, res, next);
});

router.post('/feedback/teacher', messageRateLimiter, submitStudentToTeacherFeedback);
router.post('/feedback/admin', messageRateLimiter, submitStudentToAdminFeedback);

module.exports = router;
