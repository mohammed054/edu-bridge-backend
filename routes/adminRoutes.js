const express = require('express');
const {
  listOverview,
  importUsers,
  exportUsers,
  addTeacher,
  addStudent,
  addClass,
  removeTeacher,
  removeStudent,
  removeClass,
} = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticate, authorize('admin'));

router.get('/overview', listOverview);
router.post('/import-users', importUsers);
router.get('/export-users', exportUsers);

router.post('/teachers', addTeacher);
router.delete('/teachers/:id', removeTeacher);

router.post('/students', addStudent);
router.delete('/students/:id', removeStudent);

router.post('/classes', addClass);
router.delete('/classes/:id', removeClass);

module.exports = router;
