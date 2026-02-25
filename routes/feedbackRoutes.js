const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  getFeedbackOptions,
  generateFeedback,
  listFeedbacks,
  addReply,
} = require('../controllers/feedbackController');

router.use(authenticate);

router.get('/options', authorize('teacher', 'admin'), getFeedbackOptions);
router.post('/generate', authorize('teacher'), generateFeedback);
router.get('/list', authorize('teacher', 'student', 'admin'), listFeedbacks);
router.post('/reply', authorize('student'), addReply);

module.exports = router;
