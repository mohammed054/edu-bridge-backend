const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema(
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
      enum: ['pending', 'submitted', 'graded'],
      default: 'pending',
    },
    score: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    maxMarks: {
      type: Number,
      default: 100,
      min: 1,
    },
    teacherComment: {
      type: String,
      default: '',
      trim: true,
    },
    submissionText: {
      type: String,
      default: '',
      trim: true,
    },
    submissionAttachment: {
      type: String,
      default: '',
      trim: true,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const homeworkSchema = new mongoose.Schema(
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
    description: {
      type: String,
      default: '',
      trim: true,
    },
    attachmentName: {
      type: String,
      default: '',
      trim: true,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    maxMarks: {
      type: Number,
      default: 100,
      min: 1,
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
    assignments: {
      type: [assignmentSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

homeworkSchema.index({ className: 1, subject: 1, createdAt: -1 });
homeworkSchema.index({ teacherId: 1, createdAt: -1 });

module.exports = mongoose.model('Homework', homeworkSchema);


