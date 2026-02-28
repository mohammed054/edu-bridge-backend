const express = require('express');
const { verifyToken, authorize } = require('../middleware/authMiddleware');
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  toggleNotificationPin,
} = require('../controllers/notificationController');

const router = express.Router();

router.use(verifyToken, authorize('admin', 'teacher', 'student', 'parent'));

router.get('/', listNotifications);
router.patch('/:id/read', markNotificationRead);
router.patch('/:id/pin', toggleNotificationPin);
router.post('/read-all', markAllNotificationsRead);

module.exports = router;
