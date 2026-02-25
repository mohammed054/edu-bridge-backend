const express = require('express');
const router = express.Router();
const { getTeachers, createTeacher } = require('../controllers/teacherController');

router.get('/', getTeachers);
router.post('/', createTeacher);

module.exports = router;
