const express = require('express');
const { verifyToken, authorize } = require('../middleware/authMiddleware');
const {
  listAssignedSurveys,
  submitSurveyResponse,
} = require('../controllers/surveyController');

const router = express.Router();

router.use(verifyToken, authorize('student', 'teacher'));
router.get('/', listAssignedSurveys);
router.post('/:id/responses', submitSurveyResponse);

module.exports = router;


