const mongoose = require('mongoose');

const attendanceEntrySchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    studentName: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['present', 'absent', 'late'],
      required: true,
    },
    markedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const attendanceRecordSchema = new mongoose.Schema(
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
    attendanceDate: {
      type: Date,
      required: true,
    },
    slotStartTime: {
      type: String,
      default: '',
      trim: true,
    },
    slotEndTime: {
      type: String,
      default: '',
      trim: true,
    },
    entries: {
      type: [attendanceEntrySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

attendanceRecordSchema.index(
  { className: 1, subject: 1, attendanceDate: 1, slotStartTime: 1, teacherId: 1 },
  { unique: true }
);
attendanceRecordSchema.index({ teacherId: 1, attendanceDate: -1 });
attendanceRecordSchema.index({ className: 1, attendanceDate: -1 });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);
