const express = require('express');
const router = express.Router();
const { verifyToken, authorize } = require('../middleware/authMiddleware');
const { getTeacherExams, upsertExamMark } = require('../controllers/teacherExamController');

router.use(verifyToken, authorize('teacher'));
router.get('/exams', getTeacherExams);
router.patch('/exams', upsertExamMark);

module.exports = router;
