const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema(
  {
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
    actionLine: {
      type: String,
      default: '',
      trim: true,
    },
    audienceRole: {
      type: String,
      enum: ['student', 'teacher', 'both'],
      default: 'student',
      index: true,
    },
    audienceClassNames: {
      type: [String],
      default: [],
      index: true,
    },
    audienceUserIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'published'],
      default: 'draft',
      index: true,
    },
    scheduledFor: {
      type: Date,
      default: null,
      index: true,
    },
    publishedAt: {
      type: Date,
      default: null,
      index: true,
    },
    recipientCount: {
      type: Number,
      default: 0,
    },
    createdById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    createdByName: {
      type: String,
      default: '',
      trim: true,
    },
    aiGenerated: {
      type: Boolean,
      default: false,
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
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

broadcastSchema.index({ status: 1, scheduledFor: 1, createdAt: -1 });

module.exports = mongoose.model('Broadcast', broadcastSchema);
