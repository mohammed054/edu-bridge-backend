const mongoose = require('mongoose');

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const scheduleEntrySchema = new mongoose.Schema(
  {
    institutionId: {
      type: String,
      default: 'hikmah-main',
      trim: true,
      index: true,
    },
    campusId: {
      type: String,
      default: 'main-campus',
      trim: true,
      index: true,
    },
    academicYear: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
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
    patternKey: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    copiedFromEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ScheduleEntry',
      default: null,
    },
    sourceType: {
      type: String,
      enum: ['manual', 'ocr', 'ai_suggested', 'pattern_copy'],
      default: 'manual',
    },
    status: {
      type: String,
      enum: ['draft', 'approved', 'rejected'],
      default: 'approved',
      index: true,
    },
    conflictFlags: {
      type: [String],
      default: [],
    },
    substitutionTeacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    substitutionTeacherName: {
      type: String,
      default: '',
      trim: true,
    },
    rescheduledFrom: {
      type: Date,
      default: null,
    },
    changeLog: {
      type: [
        new mongoose.Schema(
          {
            action: { type: String, required: true, trim: true },
            actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
            actorRole: { type: String, default: '', trim: true },
            summary: { type: String, default: '', trim: true },
            at: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
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
scheduleEntrySchema.index({ room: 1, dayOfWeek: 1, startTime: 1, isActive: 1 });
scheduleEntrySchema.index({ teacherId: 1, dayOfWeek: 1, startTime: 1, isActive: 1 });
scheduleEntrySchema.index({ className: 1, dayOfWeek: 1, startTime: 1, isActive: 1 });

module.exports = mongoose.model('ScheduleEntry', scheduleEntrySchema);
