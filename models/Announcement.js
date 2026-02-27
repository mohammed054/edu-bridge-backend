const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
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
    attachmentName: {
      type: String,
      default: '',
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
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

announcementSchema.index({ teacherId: 1, createdAt: -1 });
announcementSchema.index({ className: 1, subject: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
