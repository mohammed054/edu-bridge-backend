const express = require('express');
const router = express.Router();
const { createFeedback, getFeedbacksByStudent } = require('../controllers/feedbackController');

router.post('/', createFeedback);
router.get('/student/:studentId', getFeedbacksByStudent);

module.exports = router;
