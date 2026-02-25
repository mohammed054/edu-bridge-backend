const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String },
  category: { 
    type: String, 
    enum: ['teaching', 'homework', 'behavior', 'communication', 'other'],
    default: 'teaching'
  },
  aiAnalysis: {
    sentiment: { type: String },
    keywords: [String],
    suggestion: { type: String }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Feedback', feedbackSchema);
