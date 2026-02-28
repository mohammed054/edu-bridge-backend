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
      enum: ['admin', 'teacher', 'student', 'parent'],
      required: true,
    },
    adminProfile: {
      type: String,
      enum: ['super_admin', 'academic_admin', 'attendance_manager', 'support_staff', 'none'],
      default: 'none',
      index: true,
    },
    permissions: {
      type: [String],
      default: [],
    },
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
    locale: {
      type: String,
      default: 'ar-AE',
      trim: true,
    },
    timezone: {
      type: String,
      default: 'Asia/Dubai',
      trim: true,
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
    linkedStudentIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
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
    studentLifecycleState: {
      type: String,
      enum: ['active', 'probation', 'academic_warning', 'suspended', 'graduated', 'transferred', 'archived'],
      default: 'active',
      index: true,
    },
    archiveMode: {
      type: Boolean,
      default: false,
      index: true,
    },
    activeAcademicYear: {
      type: String,
      default: '',
      trim: true,
    },
    academicYearHistory: {
      type: [
        new mongoose.Schema(
          {
            academicYear: { type: String, required: true, trim: true },
            state: {
              type: String,
              enum: ['active', 'frozen', 'archived'],
              default: 'active',
            },
            promotedFromClass: { type: String, default: '', trim: true },
            promotedToClass: { type: String, default: '', trim: true },
            at: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    delegatedTeacherIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    delegationExpiresAt: {
      type: Date,
      default: null,
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

  if (this.role !== 'parent' && (this.linkedStudentIds || []).length) {
    this.linkedStudentIds = [];
  }

  if (this.role !== 'admin') {
    this.adminProfile = 'none';
  } else if (!this.adminProfile || this.adminProfile === 'none') {
    this.adminProfile = 'academic_admin';
  }

  if (this.role !== 'student') {
    this.studentLifecycleState = 'active';
    this.archiveMode = false;
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
    adminProfile: this.adminProfile || 'none',
    permissions: this.permissions || [],
    isActive: this.isActive !== false,
    profilePicture,
    avatarUrl: profilePicture,
    institutionId: this.institutionId || 'hikmah-main',
    campusId: this.campusId || 'main-campus',
    locale: this.locale || 'ar-AE',
    timezone: this.timezone || 'Asia/Dubai',
    classes,
    className: classes[0] || '',
    subject,
    subjects: subject ? [subject] : [],
    studentLifecycleState: this.studentLifecycleState || 'active',
    archiveMode: this.archiveMode === true,
    activeAcademicYear: this.activeAcademicYear || '',
    academicYearHistory: this.academicYearHistory || [],
    linkedStudentIds: (this.linkedStudentIds || []).map((item) => String(item)),
    delegatedTeacherIds: (this.delegatedTeacherIds || []).map((item) => String(item)),
    delegationExpiresAt: this.delegationExpiresAt || null,
    absentDays: this.absentDays || 0,
    negativeReports: this.negativeReports || 0,
  };
};

module.exports = mongoose.model('User', userSchema);


