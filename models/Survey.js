const mongoose = require('mongoose');

const surveyQuestionSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true, trim: true },
    prompt: { type: String, required: true, trim: true },
    type: { type: String, enum: ['text', 'multiple'], required: true },
    options: { type: [String], default: [] },
  },
  { _id: false }
);

const surveySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
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
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

surveySchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Survey', surveySchema);
