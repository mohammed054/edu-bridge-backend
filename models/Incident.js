const mongoose = require('mongoose');

const parentNotificationSchema = new mongoose.Schema(
  {
    sentAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['pending', 'read', 'responded'],
      default: 'pending',
    },
    channel: {
      type: String,
      default: 'sms',
      trim: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    responseText: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false }
);

const incidentSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    studentName: {
      type: String,
      required: true,
      trim: true,
    },
    className: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    teacherName: {
      type: String,
      default: '',
      trim: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    parentNotification: {
      type: parentNotificationSchema,
      default: () => ({
        sentAt: new Date(),
        status: 'pending',
        channel: 'sms',
        readAt: null,
        respondedAt: null,
        responseText: '',
      }),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

incidentSchema.index({ teacherId: 1, createdAt: -1 });
incidentSchema.index({ studentId: 1, createdAt: -1 });
incidentSchema.index({ className: 1, severity: 1, createdAt: -1 });
incidentSchema.index({ 'parentNotification.status': 1, createdAt: -1 });

module.exports = mongoose.model('Incident', incidentSchema);
