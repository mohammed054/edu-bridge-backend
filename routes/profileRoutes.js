const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const { getStudentProfile } = require('../controllers/profileController');

const router = express.Router();

router.use(verifyToken);
router.get('/:studentId', getStudentProfile);

module.exports = router;
