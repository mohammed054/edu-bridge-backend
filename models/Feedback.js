const mongoose = require('mongoose');

const replySchema = new mongoose.Schema(
  {
    senderType: { type: String, enum: ['teacher', 'student', 'parent'], required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const feedbackSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  studentName: { type: String, required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  className: { type: String, required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },
  teacherName: { type: String, default: 'Teacher' },
  senderType: { type: String, enum: ['teacher', 'student', 'parent'], required: true },
  tags: { type: [String], default: [] },
  notes: { type: String, default: '' },
  suggestion: { type: String, default: '' },
  message: { type: String, required: true },
  replies: {
    type: [replySchema],
    default: [],
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Feedback', feedbackSchema);
