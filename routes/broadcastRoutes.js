const express = require('express');
const { verifyToken, adminOnly } = require('../middleware/authMiddleware');
const {
  listAdminBroadcasts,
  createAdminBroadcast,
  updateAdminBroadcast,
  deleteAdminBroadcast,
  generateAdminBroadcastDraft,
} = require('../controllers/broadcastController');

const router = express.Router();

router.use(verifyToken, adminOnly);

router.get('/', listAdminBroadcasts);
router.post('/', createAdminBroadcast);
router.patch('/:id', updateAdminBroadcast);
router.delete('/:id', deleteAdminBroadcast);
router.post('/generate-draft', generateAdminBroadcastDraft);

module.exports = router;
