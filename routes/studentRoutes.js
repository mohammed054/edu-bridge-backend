const express = require('express');
const router = express.Router();
const { verifyToken, studentOnly } = require('../middleware/authMiddleware');
const { getStudentProfile } = require('../controllers/profileController');
const {
  submitStudentToTeacherFeedback,
  submitStudentToAdminFeedback,
  listFeedbacks,
} = require('../controllers/feedbackController');

router.use(verifyToken, studentOnly);

router.get('/profile', (req, res, next) => {
  req.params.studentId = req.user.id;
  return getStudentProfile(req, res, next);
});

router.get('/feedback', (req, res, next) => {
  req.query.studentId = req.user.id;
  return listFeedbacks(req, res, next);
});

router.post('/feedback/teacher', submitStudentToTeacherFeedback);
router.post('/feedback/admin', submitStudentToAdminFeedback);

module.exports = router;


