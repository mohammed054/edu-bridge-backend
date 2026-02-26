const mongoose = require('mongoose');

const examMarkSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    teacherName: {
      type: String,
      default: '',
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['admin', 'teacher', 'student'],
      required: true,
    },
    classes: {
      type: [String],
      default: [],
    },
    subjects: {
      type: [String],
      default: [],
    },
    absentDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    negativeReports: {
      type: Number,
      default: 0,
      min: 0,
    },
    examMarks: {
      type: [examMarkSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    id: String(this._id),
    username: this.username || '',
    email: this.email || '',
    name: this.name,
    role: this.role,
    classes: this.classes || [],
    subjects: this.subjects || [],
    absentDays: this.absentDays || 0,
    negativeReports: this.negativeReports || 0,
    examMarks: this.examMarks || [],
  };
};

module.exports = mongoose.model('User', userSchema);
