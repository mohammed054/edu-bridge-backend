const express = require('express');
const router = express.Router();
const { verifyToken, authorize } = require('../middleware/authMiddleware');
const {
  getFeedbackOptions,
  generateFeedback,
  listFeedbacks,
  addReply,
} = require('../controllers/feedbackController');

router.use(verifyToken);

router.get('/options', authorize('teacher', 'admin'), getFeedbackOptions);
router.post('/generate', authorize('teacher'), generateFeedback);
router.get('/list', authorize('teacher', 'student', 'admin'), listFeedbacks);
router.post('/reply', authorize('student'), addReply);

module.exports = router;
