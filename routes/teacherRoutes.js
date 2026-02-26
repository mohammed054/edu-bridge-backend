const express = require('express');
const router = express.Router();
const { verifyToken, teacherOnly } = require('../middleware/authMiddleware');
const {
  getTeacherExams,
  upsertExamMark,
  deleteExamMark,
  listTeacherHomework,
  createHomework,
  updateHomeworkAssignment,
  deleteHomework,
} = require('../controllers/teacherExamController');

router.use(verifyToken, teacherOnly);

router.get('/students', getTeacherExams);
router.get('/exams', getTeacherExams);
router.patch('/exams', upsertExamMark);
router.delete('/exams', deleteExamMark);

router.get('/homework', listTeacherHomework);
router.post('/homework', createHomework);
router.patch('/homework/:id', updateHomeworkAssignment);
router.delete('/homework/:id', deleteHomework);

module.exports = router;


