const express = require('express');
const router = express.Router();
const { verifyToken, authorize, studentOnly } = require('../middleware/authMiddleware');
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
router.post('/student-to-teacher', studentOnly, submitStudentToTeacherFeedback);
router.post('/student-to-admin', studentOnly, submitStudentToAdminFeedback);
router.get('/list', authorize('teacher', 'student', 'admin'), listFeedbacks);
router.post('/reply', studentOnly, addReply);

module.exports = router;


