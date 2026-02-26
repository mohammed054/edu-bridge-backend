const express = require('express');
const { verifyToken, authorize } = require('../middleware/authMiddleware');
const { getStudentProfile } = require('../controllers/profileController');

const router = express.Router();

router.use(verifyToken, authorize('student', 'teacher', 'admin'));
router.get('/:studentId', getStudentProfile);

module.exports = router;


