const mongoose = require('mongoose');

const surveyAnswerSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true, trim: true },
    textAnswer: { type: String, default: '', trim: true },
    selectedOptions: { type: [String], default: [] },
  },
  { _id: false }
);

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
