const express = require('express');
const {
  login,
  loginStudent,
  loginTeacher,
  loginParent,
  loginAdmin,
  getCurrentUser,
  logout,
} = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const { loginRateLimiter } = require('../middleware/rateLimitMiddleware');

const router = express.Router();

router.post('/login', loginRateLimiter, login);
router.post('/login/student', loginRateLimiter, loginStudent);
router.post('/login/teacher', loginRateLimiter, loginTeacher);
router.post('/login/parent', loginRateLimiter, loginParent);
router.post('/login/admin', loginRateLimiter, loginAdmin);
router.get('/me', verifyToken, getCurrentUser);
router.post('/logout', verifyToken, logout);

module.exports = router;
