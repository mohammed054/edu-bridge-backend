const express = require('express');
const router = express.Router();
const { verifyToken, authorize } = require('../middleware/authMiddleware');
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
router.post('/generate', authorize('teacher', 'admin'), generateFeedback);
router.post('/student-to-teacher', authorize('student'), submitStudentToTeacherFeedback);
router.post('/student-to-admin', authorize('student'), submitStudentToAdminFeedback);
router.get('/list', authorize('teacher', 'student', 'admin'), listFeedbacks);
router.post('/reply', authorize('student'), addReply);

module.exports = router;
