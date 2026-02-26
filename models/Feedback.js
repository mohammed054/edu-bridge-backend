const mongoose = require('mongoose');
const { FEEDBACK_CATEGORY_KEYS } = require('../constants/feedbackCatalog');

const replySchema = new mongoose.Schema(
  {
    senderType: { type: String, enum: ['teacher', 'student', 'admin'], required: true },
    text: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const feedbackSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentName: { type: String, required: true, trim: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null },
    className: { type: String, default: '', trim: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    teacherName: { type: String, default: '', trim: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    adminName: { type: String, default: '', trim: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['teacher', 'student', 'admin'], required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverRole: { type: String, enum: ['teacher', 'student', 'admin'], required: true },
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
    subject: { type: String, trim: true, default: '' },
    category: {
      type: String,
      enum: FEEDBACK_CATEGORY_KEYS,
      required: true,
      default: FEEDBACK_CATEGORY_KEYS[0],
    },
    subcategory: {
      type: String,
      default: '',
      trim: true,
    },
    categories: {
      type: [String],
      enum: FEEDBACK_CATEGORY_KEYS,
      default: [],
    },
    categoryDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    text: { type: String, required: true, trim: true },
    AIAnalysis: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        status: 'pending',
      },
    },
    tags: { type: [String], default: [] },
    notes: { type: String, default: '', trim: true },
    suggestion: { type: String, default: '', trim: true },
    message: { type: String, required: true, trim: true },
    content: { type: String, default: '', trim: true },
    replies: {
      type: [replySchema],
      default: [],
    },
    timestamp: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

feedbackSchema.pre('validate', function syncCategoryFields(next) {
  if (!this.categories?.length && this.category) {
    this.categories = [this.category];
  }

  if (!this.category && this.categories?.length) {
    this.category = this.categories[0];
  }

  if (!this.content && this.message) {
    this.content = this.message;
  }

  if (!this.message && this.text) {
    this.message = this.text;
  }

  if (!this.text && this.message) {
    this.text = this.message;
  }

  next();
});

feedbackSchema.index({ studentId: 1, createdAt: -1 });
feedbackSchema.index({ teacherId: 1, createdAt: -1 });
feedbackSchema.index({ adminId: 1, createdAt: -1 });
feedbackSchema.index({ senderId: 1, senderRole: 1, createdAt: -1 });
feedbackSchema.index({ receiverId: 1, receiverRole: 1, createdAt: -1 });
feedbackSchema.index({ subject: 1, createdAt: -1 });
feedbackSchema.index({ category: 1, createdAt: -1 });
feedbackSchema.index({ className: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);


