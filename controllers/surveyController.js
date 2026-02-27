
const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');
const { sendServerError } = require('../utils/safeError');

const QUESTION_TYPES = new Set(['multiple_choice', 'rating', 'text']);

const asTrimmed = (value) => String(value || '').trim();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(asTrimmed(value));

const normalizeQuestionType = (value) => {
  const raw = asTrimmed(value).toLowerCase();

  if (raw === 'multiple') {
    return 'multiple_choice';
  }

  if (QUESTION_TYPES.has(raw)) {
    return raw;
  }

  return 'text';
};

const normalizeAudience = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => asTrimmed(item).toLowerCase())
        .filter((item) => ['student', 'teacher'].includes(item))
    ),
  ];
};

const normalizeQuestionOptions = (inputOptions) =>
  [...new Set((inputOptions || []).map((item) => asTrimmed(item)).filter(Boolean))];

const normalizeQuestions = (inputQuestions) => {
  if (!Array.isArray(inputQuestions)) {
    return { questions: [], errors: ['Questions must be an array.'] };
  }

  const output = [];
  const errors = [];

  inputQuestions.forEach((item, index) => {
    const questionId = asTrimmed(item?.questionId) || `q_${index + 1}`;
    const questionText = asTrimmed(item?.questionText || item?.prompt);
    const type = normalizeQuestionType(item?.type);
    const required = Boolean(item?.required);

    let options = [];
    if (type === 'multiple_choice') {
      if (Array.isArray(item?.options)) {
        options = normalizeQuestionOptions(item.options);
      } else if (typeof item?.optionsText === 'string') {
        options = normalizeQuestionOptions(item.optionsText.split(','));
      }
    }

    if (!questionText) {
      errors.push(`Question ${index + 1}: text is required.`);
      return;
    }

    if (type === 'multiple_choice' && options.length < 2) {
      errors.push(`Question ${index + 1}: multiple choice requires at least two options.`);
      return;
    }

    output.push({
      questionId,
      questionText,
      prompt: questionText,
      type,
      options,
      required,
    });
  });

  return { questions: output, errors };
};

const normalizeAssignedUsers = async (value, audience) => {
  if (!Array.isArray(value) || !value.length) {
    return [];
  }

  const objectIds = value
    .map((item) => {
      try {
        return new mongoose.Types.ObjectId(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (!objectIds.length) {
    return [];
  }

  const validUsers = await User.find(
    {
      _id: { $in: objectIds },
      role: { $in: audience },
    },
    { _id: 1 }
  ).lean();

  return validUsers.map((item) => item._id);
};

const normalizeSurveyQuestion = (question, index) => {
  const questionId = asTrimmed(question?.questionId) || `q_${index + 1}`;
  const questionText = asTrimmed(question?.questionText || question?.prompt);
  const type = normalizeQuestionType(question?.type);
  const options = type === 'multiple_choice' ? normalizeQuestionOptions(question?.options || []) : [];

  return {
    questionId,
    questionText,
    prompt: questionText,
    type,
    options,
    required: Boolean(question?.required),
  };
};

const surveyPayload = (survey, extra = {}) => {
  const title = asTrimmed(survey.title || survey.name);

  return {
    id: String(survey._id),
    title,
    name: title,
    description: survey.description || '',
    audience: survey.audience || [],
    assignedUserIds: (survey.assignedUserIds || []).map((id) => String(id)),
    questions: (survey.questions || []).map(normalizeSurveyQuestion),
    isActive: Boolean(survey.isActive),
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt,
    ...extra,
  };
};

const listAdminSurveys = async (_req, res) => {
  try {
    const surveys = await Survey.find().sort({ createdAt: -1 }).lean();
    const responseCounts = await SurveyResponse.aggregate([
      {
        $group: {
          _id: '$surveyId',
          totalResponses: { $sum: 1 },
        },
      },
    ]);

    const countBySurveyId = responseCounts.reduce((acc, item) => {
      acc[String(item._id)] = item.totalResponses;
      return acc;
    }, {});

    return res.json({
      surveys: surveys.map((survey) =>
        surveyPayload(survey, { totalResponses: countBySurveyId[String(survey._id)] || 0 })
      ),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load surveys.');
  }
};

const createSurvey = async (req, res) => {
  try {
    const title = asTrimmed(req.body?.title || req.body?.name);
    const description = asTrimmed(req.body?.description);
    const audience = normalizeAudience(req.body?.audience || []);
    const { questions, errors } = normalizeQuestions(req.body?.questions || []);

    if (!title) {
      return res.status(400).json({ message: 'Survey title is required.' });
    }

    if (!audience.length) {
      return res.status(400).json({ message: 'At least one audience role is required.' });
    }

    if (!questions.length || errors.length) {
      return res.status(400).json({
        message: 'Survey questions are invalid.',
        errors,
      });
    }

    const assignedUserIds = await normalizeAssignedUsers(req.body?.assignedUserIds || [], audience);

    const created = await Survey.create({
      title,
      name: title,
      description,
      audience,
      assignedUserIds,
      questions,
      createdBy: req.user.id,
      isActive: req.body?.isActive !== false,
    });

    return res.status(201).json({ survey: surveyPayload(created.toObject()) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to create survey.');
  }
};

const updateSurvey = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Survey identifier is invalid.' });
    }

    const existing = await Survey.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    const nextAudience = req.body?.audience
      ? normalizeAudience(req.body?.audience)
      : normalizeAudience(existing.audience);

    if (!nextAudience.length) {
      return res.status(400).json({ message: 'At least one audience role is required.' });
    }

    let nextQuestions = existing.questions;
    if (req.body?.questions !== undefined) {
      const { questions, errors } = normalizeQuestions(req.body?.questions);
      if (!questions.length || errors.length) {
        return res.status(400).json({
          message: 'Survey questions are invalid.',
          errors,
        });
      }
      nextQuestions = questions;
    }

    let assignedUserIds = existing.assignedUserIds;
    if (req.body?.assignedUserIds !== undefined) {
      assignedUserIds = await normalizeAssignedUsers(req.body?.assignedUserIds || [], nextAudience);
    }

    if (req.body?.title !== undefined || req.body?.name !== undefined) {
      const nextTitle = asTrimmed(req.body?.title || req.body?.name);
      if (!nextTitle) {
        return res.status(400).json({ message: 'Survey title is required.' });
      }
      existing.title = nextTitle;
      existing.name = nextTitle;
    }

    if (req.body?.description !== undefined) {
      existing.description = asTrimmed(req.body.description);
    }

    existing.audience = nextAudience;
    existing.questions = nextQuestions;
    existing.assignedUserIds = assignedUserIds;

    if (req.body?.isActive !== undefined) {
      existing.isActive = Boolean(req.body.isActive);
    }

    await existing.save();

    return res.json({ survey: surveyPayload(existing.toObject()) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to update survey.');
  }
};

const deleteSurvey = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Survey identifier is invalid.' });
    }

    const survey = await Survey.findByIdAndDelete(req.params.id);
    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    await SurveyResponse.deleteMany({ surveyId: survey._id });
    return res.json({ success: true, deletedSurveyId: String(survey._id) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to delete survey.');
  }
};

const listSurveyResponsesForAdmin = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Survey identifier is invalid.' });
    }

    const survey = await Survey.findById(req.params.id).lean();
    if (!survey) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    const responses = await SurveyResponse.find({ surveyId: survey._id }).sort({ createdAt: -1 }).lean();
    const respondents = await User.find(
      { _id: { $in: responses.map((item) => item.respondentId) } },
      { name: 1, email: 1, role: 1 }
    ).lean();

    const respondentById = respondents.reduce((acc, item) => {
      acc[String(item._id)] = item;
      return acc;
    }, {});

    return res.json({
      survey: surveyPayload(survey),
      responses: responses.map((item) => ({
        id: String(item._id),
        respondentId: String(item.respondentId),
        respondentName: respondentById[String(item.respondentId)]?.name || 'Unknown',
        respondentEmail: respondentById[String(item.respondentId)]?.email || '',
        respondentRole: item.respondentRole,
        answers: item.answers || [],
        submittedAt: item.createdAt,
      })),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to fetch survey responses.');
  }
};
const listAssignedSurveys = async (req, res) => {
  try {
    const query = {
      isActive: true,
      audience: req.user.role,
      $or: [{ assignedUserIds: { $size: 0 } }, { assignedUserIds: req.user.id }],
    };

    const surveys = await Survey.find(query).sort({ createdAt: -1 }).lean();
    const responses = await SurveyResponse.find({
      surveyId: { $in: surveys.map((item) => item._id) },
      respondentId: req.user.id,
      respondentRole: req.user.role,
    }).lean();

    const responseBySurvey = responses.reduce((acc, item) => {
      acc[String(item.surveyId)] = item;
      return acc;
    }, {});

    return res.json({
      surveys: surveys.map((survey) =>
        surveyPayload(survey, {
          myResponse: responseBySurvey[String(survey._id)]
            ? {
                id: String(responseBySurvey[String(survey._id)]._id),
                answers: responseBySurvey[String(survey._id)].answers || [],
                submittedAt: responseBySurvey[String(survey._id)].createdAt,
              }
            : null,
        })
      ),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load assigned surveys.');
  }
};

const submitSurveyResponse = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Survey identifier is invalid.' });
    }

    const survey = await Survey.findById(req.params.id).lean();
    if (!survey || !survey.isActive) {
      return res.status(404).json({ message: 'Survey not found.' });
    }

    if (!(survey.audience || []).includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have access to this survey.' });
    }

    const assignedUserIds = (survey.assignedUserIds || []).map((id) => String(id));
    if (assignedUserIds.length && !assignedUserIds.includes(String(req.user.id))) {
      return res.status(403).json({ message: 'This survey is not assigned to your account.' });
    }

    const inputAnswers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const inputByQuestionId = inputAnswers.reduce((acc, item) => {
      const key = asTrimmed(item?.questionId);
      if (key) {
        acc[key] = item;
      }
      return acc;
    }, {});

    const questions = (survey.questions || []).map(normalizeSurveyQuestion);
    const normalizedAnswers = [];
    const validationErrors = [];

    questions.forEach((question, index) => {
      const answer = inputByQuestionId[question.questionId] || {};

      if (question.type === 'multiple_choice') {
        const selectedOptions = normalizeQuestionOptions(answer?.selectedOptions || []).filter((item) =>
          question.options.includes(item)
        );

        if (question.required && !selectedOptions.length) {
          validationErrors.push(`Question ${index + 1}: at least one option is required.`);
          return;
        }

        if (selectedOptions.length) {
          normalizedAnswers.push({
            questionId: question.questionId,
            selectedOptions,
            textAnswer: '',
            ratingValue: null,
          });
        }

        return;
      }

      if (question.type === 'rating') {
        const incomingRating =
          answer?.ratingValue !== undefined && answer?.ratingValue !== null && answer?.ratingValue !== ''
            ? Number(answer.ratingValue)
            : null;

        if (question.required && incomingRating === null) {
          validationErrors.push(`Question ${index + 1}: rating is required.`);
          return;
        }

        if (incomingRating !== null) {
          if (Number.isNaN(incomingRating) || incomingRating < 1 || incomingRating > 5) {
            validationErrors.push(`Question ${index + 1}: rating must be between 1 and 5.`);
            return;
          }

          normalizedAnswers.push({
            questionId: question.questionId,
            ratingValue: Math.round(incomingRating),
            textAnswer: '',
            selectedOptions: [],
          });
        }

        return;
      }

      const textAnswer = asTrimmed(answer?.textAnswer);
      if (question.required && !textAnswer) {
        validationErrors.push(`Question ${index + 1}: answer text is required.`);
        return;
      }

      if (textAnswer) {
        normalizedAnswers.push({
          questionId: question.questionId,
          textAnswer,
          selectedOptions: [],
          ratingValue: null,
        });
      }
    });

    if (validationErrors.length) {
      return res.status(400).json({
        message: 'Survey response validation failed.',
        errors: validationErrors,
      });
    }

    if (!normalizedAnswers.length) {
      return res.status(400).json({ message: 'At least one answer is required.' });
    }

    const response = await SurveyResponse.findOneAndUpdate(
      {
        surveyId: survey._id,
        respondentId: req.user.id,
      },
      {
        $set: {
          respondentRole: req.user.role,
          answers: normalizedAnswers,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    await Survey.updateOne({ _id: survey._id }, { $addToSet: { responses: response._id } });

    return res.status(201).json({
      response: {
        id: String(response._id),
        surveyId: String(response.surveyId),
        answers: response.answers || [],
        submittedAt: response.createdAt,
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to submit survey response.');
  }
};

module.exports = {
  listAdminSurveys,
  createSurvey,
  updateSurvey,
  deleteSurvey,
  listSurveyResponsesForAdmin,
  listAssignedSurveys,
  submitSurveyResponse,
};
