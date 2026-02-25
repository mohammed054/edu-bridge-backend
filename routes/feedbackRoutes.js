const express = require('express');
const router = express.Router();
const {
  getFeedbackOptions,
  generateFeedback,
  listFeedbacks,
  addReply,
} = require('../controllers/feedbackController');

router.get('/options', getFeedbackOptions);
router.post('/generate', generateFeedback);
router.get('/list', listFeedbacks);
router.post('/reply', addReply);

module.exports = router;
