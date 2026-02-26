const express = require('express');
const {
  login,
  loginStudent,
  loginTeacher,
  loginAdmin,
  getCurrentUser,
} = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/login', login);
router.post('/login/student', loginStudent);
router.post('/login/teacher', loginTeacher);
router.post('/login/admin', loginAdmin);
router.get('/me', verifyToken, getCurrentUser);

module.exports = router;
