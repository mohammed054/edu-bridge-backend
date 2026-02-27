const mongoose = require('mongoose');

const buildAvatarUrl = (seed) =>
  `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(seed || 'user')}`;

const examMarkSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    examTitle: {
      type: String,
      default: 'اختبار',
      trim: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    rawScore: {
      type: Number,
      default: null,
      min: 0,
    },
    maxMarks: {
      type: Number,
      default: 100,
      min: 1,
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

const homeworkSchema = new mongoose.Schema(
  {
    homeworkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Homework',
      default: null,
    },
    title: {
      type: String,
      default: '',
      trim: true,
    },
    subject: {
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
    dueDate: {
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
    isActive: {
      type: Boolean,
      default: true,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    profilePicture: {
      type: String,
      default: '',
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: '',
      trim: true,
    },
    classes: {
      type: [String],
      default: [],
    },
    subject: {
      type: String,
      default: '',
      trim: true,
    },
    subjects: {
      type: [String],
      default: [],
    },
    feedbackHistory: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Feedback',
      default: [],
    },
    examMarks: {
      type: [examMarkSchema],
      default: [],
    },
    homework: {
      type: [homeworkSchema],
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
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', function normalizeTeacherSubject(next) {
  if (this.role === 'teacher') {
    const normalized = this.subject || (this.subjects || [])[0] || '';
    this.subject = normalized;
    this.subjects = normalized ? [normalized] : [];
  }

  if (this.role === 'student' && (this.classes || []).length > 1) {
    this.classes = this.classes.slice(0, 1);
  }

  next();
});

userSchema.methods.toSafeObject = function toSafeObject() {
  const avatarSeed =
    this.name || this.email || this.username || (this._id ? String(this._id) : 'user');
  const profilePicture = this.profilePicture || this.avatarUrl || buildAvatarUrl(avatarSeed);
  const subject = this.subject || (this.subjects || [])[0] || '';
  const classes = this.classes || [];

  return {
    id: String(this._id),
    username: this.username || '',
    email: this.email || '',
    name: this.name,
    role: this.role,
    isActive: this.isActive !== false,
    profilePicture,
    avatarUrl: profilePicture,
    classes,
    className: classes[0] || '',
    subject,
    subjects: subject ? [subject] : [],
    absentDays: this.absentDays || 0,
    negativeReports: this.negativeReports || 0,
  };
};

module.exports = mongoose.model('User', userSchema);


