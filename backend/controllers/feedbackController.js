const Feedback = require('../models/Feedback');

const createFeedback = async (req, res) => {
  try {
    const feedback = new Feedback(req.body);
    const newFeedback = await feedback.save();
    res.status(201).json(newFeedback);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getFeedbacksByStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const feedbacks = await Feedback.find({ studentId })
      .populate('teacherId', 'name subject')
      .populate('classId', 'name grade');
    res.json(feedbacks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createFeedback, getFeedbacksByStudent };
