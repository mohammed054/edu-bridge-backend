const express = require('express');
const router = express.Router();
const { verifyToken, authorize, studentOnly } = require('../middleware/authMiddleware');
const { messageRateLimiter } = require('../middleware/rateLimitMiddleware');
const {
  getFeedbackOptions,
  generateFeedback,
  submitStudentToTeacherFeedback,
  submitStudentToAdminFeedback,
  listFeedbacks,
  addReply,
} = require('../controllers/feedbackController');

router.use(verifyToken);

router.get('/options', authorize('teacher', 'admin', 'student'), getFeedbackOptions);
router.post('/generate', authorize('teacher', 'admin'), messageRateLimiter, generateFeedback);
router.post('/student-to-teacher', studentOnly, messageRateLimiter, submitStudentToTeacherFeedback);
router.post('/student-to-admin', studentOnly, messageRateLimiter, submitStudentToAdminFeedback);
router.get('/list', authorize('teacher', 'student', 'admin'), listFeedbacks);
router.post('/reply', studentOnly, messageRateLimiter, addReply);

module.exports = router;


