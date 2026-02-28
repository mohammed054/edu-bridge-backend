const express = require('express');
const router = express.Router();
const { verifyToken, authorize, studentOnly } = require('../middleware/authMiddleware');
const { messageRateLimiter } = require('../middleware/rateLimitMiddleware');
const {
  getFeedbackOptions,
  generateFeedback,
  submitStudentToTeacherFeedback,
  submitStudentToAdminFeedback,
  submitStudentToParentFeedback,
  previewStudentAiFeedback,
  sendStudentAiFeedback,
  rewriteStudentFeedback,
  listFeedbacks,
  addReply,
  listTeacherReviewQueue,
  reviewTeacherDraft,
  assignFeedbackFollowUpOwner,
  listAdminFeedbackIntelligence,
  exportAdminFeedbackIntelligence,
} = require('../controllers/feedbackController');

router.use(verifyToken);

router.get('/options', authorize('teacher', 'admin', 'student'), getFeedbackOptions);
router.post('/generate', authorize('teacher', 'admin'), messageRateLimiter, generateFeedback);
router.post('/student-to-teacher', studentOnly, messageRateLimiter, submitStudentToTeacherFeedback);
router.post('/student-to-admin', studentOnly, messageRateLimiter, submitStudentToAdminFeedback);
router.post('/student-to-parent', studentOnly, messageRateLimiter, submitStudentToParentFeedback);
router.post('/student/preview-ai', studentOnly, messageRateLimiter, previewStudentAiFeedback);
router.post('/student/send-ai', studentOnly, messageRateLimiter, sendStudentAiFeedback);
router.post('/student/rewrite', studentOnly, messageRateLimiter, rewriteStudentFeedback);
router.get('/list', authorize('teacher', 'student', 'admin', 'parent'), listFeedbacks);
router.post('/reply', studentOnly, messageRateLimiter, addReply);
router.get('/teacher/review-queue', authorize('teacher'), listTeacherReviewQueue);
router.post('/:id/teacher-review', authorize('teacher'), messageRateLimiter, reviewTeacherDraft);
router.patch('/:id/follow-up-owner', authorize('admin'), assignFeedbackFollowUpOwner);
router.get('/admin/intelligence', authorize('admin'), listAdminFeedbackIntelligence);
router.get('/admin/intelligence/export', authorize('admin'), exportAdminFeedbackIntelligence);

module.exports = router;


