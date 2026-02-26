const express = require('express');
const router = express.Router();
const { verifyToken, authorize } = require('../middleware/authMiddleware');
const {
  getTeacherExams,
  upsertExamMark,
  deleteExamMark,
} = require('../controllers/teacherExamController');

router.use(verifyToken, authorize('teacher'));
router.get('/exams', getTeacherExams);
router.patch('/exams', upsertExamMark);
router.delete('/exams', deleteExamMark);

module.exports = router;
