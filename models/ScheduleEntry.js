const mongoose = require('mongoose');

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const scheduleEntrySchema = new mongoose.Schema(
  {
    className: {
      type: String,
      required: true,
      trim: true,
    },
    grade: {
      type: String,
      default: '',
      trim: true,
    },
    dayOfWeek: {
      type: Number,
      required: true,
      min: 1,
      max: 7,
    },
    startTime: {
      type: String,
      required: true,
      match: TIME_PATTERN,
    },
    endTime: {
      type: String,
      required: true,
      match: TIME_PATTERN,
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
    room: {
      type: String,
      default: '',
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

scheduleEntrySchema.index(
  { className: 1, dayOfWeek: 1, startTime: 1, subject: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);
scheduleEntrySchema.index({ teacherId: 1, dayOfWeek: 1, startTime: 1, isActive: 1 });
scheduleEntrySchema.index({ className: 1, dayOfWeek: 1, startTime: 1, isActive: 1 });

module.exports = mongoose.model('ScheduleEntry', scheduleEntrySchema);
