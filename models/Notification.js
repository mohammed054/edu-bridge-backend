const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipientRole: {
      type: String,
      enum: ['admin', 'teacher', 'student', 'parent'],
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: ['feedback', 'broadcast', 'schedule', 'incident', 'system', 'ticket', 'risk', 'capacity', 'survey'],
      default: 'system',
      index: true,
    },
    urgency: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low',
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      default: '',
      trim: true,
    },
    link: {
      type: String,
      default: '',
      trim: true,
    },
    sourceType: {
      type: String,
      default: '',
      trim: true,
    },
    sourceId: {
      type: String,
      default: '',
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    workflowStatus: {
      type: String,
      enum: ['open', 'pending', 'resolved', 'escalated'],
      default: 'open',
      index: true,
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
      default: null,
    },
    priorityWeight: {
      type: Number,
      default: 1,
      min: 1,
      max: 5,
      index: true,
    },
    escalationLevel: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      index: true,
    },
    escalatedAt: {
      type: Date,
      default: null,
    },
    dueAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    requiresAcknowledgement: {
      type: Boolean,
      default: false,
      index: true,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, isPinned: -1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
