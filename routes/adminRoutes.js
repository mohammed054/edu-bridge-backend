const express = require('express');
const {
  listOverview,
  getReports,
  importUsers,
  exportUsers,
  addTeacher,
  addStudent,
  addClass,
  removeTeacher,
  removeStudent,
  removeClass,
  updateTeacherAssignment,
  updateStudentAssignment,
} = require('../controllers/adminController');
const {
  listAdminSurveys,
  createSurvey,
  updateSurvey,
  deleteSurvey,
  listSurveyResponsesForAdmin,
} = require('../controllers/surveyController');
const { verifyToken, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(verifyToken, authorize('admin'));

router.get('/overview', listOverview);
router.get('/reports', getReports);
router.post('/import-users', importUsers);
router.get('/export-users', exportUsers);

router.post('/teachers', addTeacher);
router.patch('/teachers/:id/assignment', updateTeacherAssignment);
router.delete('/teachers/:id', removeTeacher);

router.post('/students', addStudent);
router.patch('/students/:id/assignment', updateStudentAssignment);
router.delete('/students/:id', removeStudent);

router.post('/classes', addClass);
router.delete('/classes/:id', removeClass);

router.get('/surveys', listAdminSurveys);
router.post('/surveys', createSurvey);
router.patch('/surveys/:id', updateSurvey);
router.delete('/surveys/:id', deleteSurvey);
router.get('/surveys/:id/responses', listSurveyResponsesForAdmin);

module.exports = router;
