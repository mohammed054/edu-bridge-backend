const mongoose = require('mongoose');

const QUESTION_TYPES = ['multiple_choice', 'rating', 'text'];

const surveyQuestionSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true, trim: true },
    questionText: { type: String, required: true, trim: true },
    prompt: { type: String, default: '', trim: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

surveyQuestionSchema.pre('validate', function normalizeLegacyQuestion(next) {
  const text = String(this.questionText || this.prompt || '').trim();
  this.questionText = text;
  this.prompt = text;

  const rawType = String(this.type || '').trim().toLowerCase();
  if (rawType === 'multiple') {
    this.type = 'multiple_choice';
  } else if (QUESTION_TYPES.includes(rawType)) {
    this.type = rawType;
  } else {
    this.type = 'text';
  }

  if (this.type !== 'multiple_choice') {
    this.options = [];
  } else {
    this.options = [...new Set((this.options || []).map((item) => String(item || '').trim()).filter(Boolean))];
  }

  next();
});

const surveySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    name: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    audience: {
      type: [String],
      enum: ['student', 'teacher'],
      required: true,
      default: ['student'],
    },
    assignedUserIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    questions: { type: [surveyQuestionSchema], default: [] },
    responses: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'SurveyResponse',
      default: [],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

surveySchema.pre('validate', function syncTitleAndName(next) {
  const normalizedTitle = String(this.title || this.name || '').trim();
  this.title = normalizedTitle;
  this.name = normalizedTitle;
  next();
});

surveySchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Survey', surveySchema);
