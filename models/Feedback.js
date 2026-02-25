const mongoose = require('mongoose');

const replySchema = new mongoose.Schema(
  {
    senderType: { type: String, enum: ['teacher', 'student', 'admin'], required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const feedbackSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentName: { type: String, required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null },
    className: { type: String, default: '' },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    teacherName: { type: String, default: 'Teacher' },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    adminName: { type: String, default: '' },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    senderRole: { type: String, enum: ['teacher', 'student', 'admin'], default: null },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receiverRole: { type: String, enum: ['teacher', 'student', 'admin'], default: null },
    senderType: { type: String, enum: ['teacher', 'student', 'admin'], required: true },
    feedbackType: {
      type: String,
      enum: [
        'teacher_feedback',
        'admin_feedback',
        'student_to_teacher',
        'student_to_admin',
        'student_reply',
      ],
      default: 'teacher_feedback',
    },
    tags: { type: [String], default: [] },
    notes: { type: String, default: '' },
    suggestion: { type: String, default: '' },
    message: { type: String, required: true },
    content: { type: String, default: '' },
    replies: {
      type: [replySchema],
      default: [],
    },
    timestamp: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
  }
);

feedbackSchema.index({ studentId: 1, feedbackType: 1, createdAt: -1 });
feedbackSchema.index({ teacherId: 1, feedbackType: 1, createdAt: -1 });
feedbackSchema.index({ adminId: 1, feedbackType: 1, createdAt: -1 });
feedbackSchema.index({ senderId: 1, senderRole: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
