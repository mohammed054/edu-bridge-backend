const mongoose = require('mongoose');
const { FEEDBACK_CATEGORY_KEYS } = require('../constants/feedbackCatalog');

const replySchema = new mongoose.Schema(
  {
    senderType: { type: String, enum: ['teacher', 'student', 'admin', 'parent'], required: true },
    text: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const statusTimelineSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['draft', 'sent', 'reviewed', 'rejected', 'clarification_requested', 'forwarded'],
      required: true,
    },
    actorRole: {
      type: String,
      enum: ['teacher', 'student', 'admin', 'parent'],
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    note: {
      type: String,
      default: '',
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
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
    senderRole: { type: String, enum: ['teacher', 'student', 'admin', 'parent'], required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverRole: { type: String, enum: ['teacher', 'student', 'admin', 'parent'], required: true },
    senderType: { type: String, enum: ['teacher', 'student', 'admin', 'parent'], required: true },
    feedbackType: {
      type: String,
      enum: [
        'teacher_feedback',
        'admin_feedback',
        'student_to_teacher',
        'student_to_admin',
        'student_to_parent',
        'student_reply',
        'parent_reply',
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
    aiGenerated: {
      type: Boolean,
      default: false,
    },
    urgency: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low',
    },
    ticketStatus: {
      type: String,
      enum: ['open', 'pending', 'resolved'],
      default: 'open',
      index: true,
    },
    ticketId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    slaDueAt: {
      type: Date,
      default: null,
      index: true,
    },
    firstResponseAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    assignedToId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    assignedToRole: {
      type: String,
      enum: ['admin', 'teacher', 'student', 'parent'],
      default: '',
    },
    priority: {
      type: String,
      enum: ['p1', 'p2', 'p3'],
      default: 'p3',
      index: true,
    },
    escalationCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    trendFlags: {
      type: [String],
      default: [],
    },
    aiSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    visualSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    workflowStatus: {
      type: String,
      enum: ['draft', 'sent', 'reviewed', 'rejected', 'clarification_requested', 'forwarded'],
      default: 'sent',
      index: true,
    },
    statusTimeline: {
      type: [statusTimelineSchema],
      default: [],
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedByRole: {
      type: String,
      enum: ['teacher', 'student', 'admin', 'parent'],
      default: '',
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewAction: {
      type: String,
      default: '',
      trim: true,
    },
    reviewNote: {
      type: String,
      default: '',
      trim: true,
    },
    clarificationRequest: {
      type: String,
      default: '',
      trim: true,
    },
    parentFeedbackId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Feedback',
      default: null,
    },
    followUpOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    followUpOwnerName: {
      type: String,
      default: '',
      trim: true,
    },
    aiLabel: {
      type: String,
      default: '',
      trim: true,
    },
    aiUpdatedAt: {
      type: Date,
      default: null,
    },
    readBy: {
      type: [
        new mongoose.Schema(
          {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
            role: { type: String, enum: ['teacher', 'student', 'admin', 'parent'], required: true },
            readAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
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

  if (!this.workflowStatus) {
    this.workflowStatus = 'sent';
  }

  if (!this.ticketId) {
    const base = (this._id || new mongoose.Types.ObjectId()).toString().slice(-8).toUpperCase();
    this.ticketId = `FDB-${base}`;
  }

  if (!Array.isArray(this.statusTimeline)) {
    this.statusTimeline = [];
  }

  if (!this.statusTimeline.length) {
    this.statusTimeline.push({
      status: this.workflowStatus || 'sent',
      actorRole: this.senderRole || this.senderType || 'student',
      actorId: this.senderId || null,
      note: '',
      createdAt: this.createdAt || new Date(),
    });
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
feedbackSchema.index({ workflowStatus: 1, createdAt: -1 });
feedbackSchema.index({ receiverId: 1, workflowStatus: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);


