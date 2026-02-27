const mongoose = require('mongoose');

const surveyAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true, trim: true },
    textAnswer: { type: String, default: '', trim: true },
    selectedOptions: { type: [String], default: [] },
    ratingValue: {
      type: Number,
      default: null,
      min: 1,
      max: 5,
    },
  },
  { _id: false }
);

surveyAnswerSchema.pre('validate', function normalizeAnswer(next) {
  this.textAnswer = String(this.textAnswer || '').trim();
  this.selectedOptions = [...new Set((this.selectedOptions || []).map((item) => String(item || '').trim()).filter(Boolean))];

  if (this.ratingValue === '' || this.ratingValue === undefined) {
    this.ratingValue = null;
  }

  if (this.ratingValue !== null) {
    const numeric = Number(this.ratingValue);
    this.ratingValue = Number.isNaN(numeric) ? null : Math.round(numeric);
  }

  next();
});

const surveyResponseSchema = new mongoose.Schema(
  {
    surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey', required: true },
    respondentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    respondentRole: { type: String, enum: ['student', 'teacher'], required: true },
    answers: { type: [surveyAnswerSchema], default: [] },
  },
  { timestamps: true }
);

surveyResponseSchema.index({ surveyId: 1, respondentId: 1 }, { unique: true });
surveyResponseSchema.index({ respondentRole: 1, createdAt: -1 });

module.exports = mongoose.model('SurveyResponse', surveyResponseSchema);
