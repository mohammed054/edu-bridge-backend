const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const asTrimmed = (value) => String(value || '').trim();

const normalizeAudience = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => asTrimmed(item)).filter((item) => ['student', 'teacher'].includes(item)))];
};

const normalizeQuestions = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      const type = asTrimmed(item?.type) === 'multiple' ? 'multiple' : 'text';
      const questionId = asTrimmed(item?.questionId) || `q_${index + 1}`;
      const prompt = asTrimmed(item?.prompt);
      const options =
        type === 'multiple'
          ? [...new Set((item?.options || []).map((entry) => asTrimmed(entry)).filter(Boolean))]
          : [];

      if (!prompt) {
        return null;
      }
      if (type === 'multiple' && options.length < 2) {
        return null;
      }

      return {
        questionId,
        prompt,
        type,
        options,
      };
    })
    .filter(Boolean);
};

const normalizeAssignedUsers = async (value, audience) => {
  if (!Array.isArray(value) || !value.length) {
    return [];
  }

  const validUsers = await User.find(
    {
      _id: {
        $in: value
          .map((item) => {
            try {
              return new mongoose.Types.ObjectId(item);
            } catch {
              return null;
            }
          })
          .filter(Boolean),
      },
      role: { $in: audience },
    },
    { _id: 1 }
  ).lean();

  return validUsers.map((item) => item._id);
};

const surveyPayload = (survey, extra = {}) => ({
  id: String(survey._id),
  name: survey.name,
  description: survey.description || '',
  audience: survey.audience || [],
  assignedUserIds: (survey.assignedUserIds || []).map((id) => String(id)),
  questions: survey.questions || [],
  isActive: Boolean(survey.isActive),
  createdAt: survey.createdAt,
  updatedAt: survey.updatedAt,
  ...extra,
});

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
    return res.status(500).json({ message: error.message || '???? ????? ???????????.' });
  }
};

const createSurvey = async (req, res) => {
  try {
    const name = asTrimmed(req.body?.name);
    const description = asTrimmed(req.body?.description);
    const audience = normalizeAudience(req.body?.audience || []);
    const questions = normalizeQuestions(req.body?.questions || []);

    if (!name) {
      return res.status(400).json({ message: '??? ????????? ?????.' });
    }
    if (!audience.length) {
      return res.status(400).json({ message: '??? ????????? ??????.' });
    }
    if (!questions.length) {
      return res.status(400).json({ message: '??? ????? ???? ???? ???? ??? ?????.' });
    }

    const assignedUserIds = await normalizeAssignedUsers(req.body?.assignedUserIds || [], audience);

    const created = await Survey.create({
      name,
      description,
      audience,
      assignedUserIds,
      questions,
      createdBy: req.user.id,
      isActive: req.body?.isActive !== false,
    });

    return res.status(201).json({ survey: surveyPayload(created.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ?????????.' });
  }
};

const updateSurvey = async (req, res) => {
  try {
    const existing = await Survey.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: '????????? ??? ?????.' });
    }

    const audience = req.body?.audience ? normalizeAudience(req.body?.audience || []) : existing.audience;
    const questions = req.body?.questions ? normalizeQuestions(req.body?.questions || []) : existing.questions;

    if (!audience.length) {
      return res.status(400).json({ message: '??? ????????? ??????.' });
    }
    if (!questions.length) {
      return res.status(400).json({ message: '??? ????? ???? ???? ???? ??? ?????.' });
    }

    const assignedUserIds = req.body?.assignedUserIds
      ? await normalizeAssignedUsers(req.body?.assignedUserIds || [], audience)
      : existing.assignedUserIds;

    existing.name = req.body?.name !== undefined ? asTrimmed(req.body.name) : existing.name;
    existing.description =
      req.body?.description !== undefined ? asTrimmed(req.body.description) : existing.description;
    existing.audience = audience;
    existing.questions = questions;
    existing.assignedUserIds = assignedUserIds;
    if (req.body?.isActive !== undefined) {
      existing.isActive = Boolean(req.body.isActive);
    }

    await existing.save();
    return res.json({ survey: surveyPayload(existing.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ?????????.' });
  }
};

const deleteSurvey = async (req, res) => {
  try {
    const survey = await Survey.findByIdAndDelete(req.params.id);
    if (!survey) {
      return res.status(404).json({ message: '????????? ??? ?????.' });
    }

    await SurveyResponse.deleteMany({ surveyId: survey._id });
    return res.json({ message: '?? ??? ????????? ?????.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ??? ?????????.' });
  }
};

const listSurveyResponsesForAdmin = async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id).lean();
    if (!survey) {
      return res.status(404).json({ message: '????????? ??? ?????.' });
    }

    const responses = await SurveyResponse.find({ surveyId: survey._id }).sort({ createdAt: -1 }).lean();
    const respondents = await User.find(
      {
        _id: { $in: responses.map((item) => item.respondentId) },
      },
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
        respondentName: respondentById[String(item.respondentId)]?.name || '??????',
        respondentEmail: respondentById[String(item.respondentId)]?.email || '',
        respondentRole: item.respondentRole,
        answers: item.answers || [],
        submittedAt: item.createdAt,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ???? ?????????.' });
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
    return res.status(500).json({ message: error.message || '???? ????? ??????????? ???????.' });
  }
};

const submitSurveyResponse = async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id).lean();
    if (!survey || !survey.isActive) {
      return res.status(404).json({ message: '????????? ??? ?????.' });
    }

    if (!(survey.audience || []).includes(req.user.role)) {
      return res.status(403).json({ message: '?? ???? ?????? ???? ??? ??? ?????????.' });
    }

    const assignedUserIds = (survey.assignedUserIds || []).map((id) => String(id));
    if (assignedUserIds.length && !assignedUserIds.includes(String(req.user.id))) {
      return res.status(403).json({ message: '?? ??? ????? ??? ????????? ??.' });
    }

    const answersInput = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const questionMap = (survey.questions || []).reduce((acc, item) => {
      acc[item.questionId] = item;
      return acc;
    }, {});

    const answers = answersInput
      .map((item) => {
        const questionId = asTrimmed(item?.questionId);
        const question = questionMap[questionId];
        if (!question) {
          return null;
        }

        if (question.type === 'multiple') {
          const selectedOptions = [...new Set((item?.selectedOptions || []).map((entry) => asTrimmed(entry)))]
            .filter(Boolean)
            .filter((entry) => question.options.includes(entry));

          if (!selectedOptions.length) {
            return null;
          }

          return {
            questionId,
            selectedOptions,
            textAnswer: '',
          };
        }

        const textAnswer = asTrimmed(item?.textAnswer);
        if (!textAnswer) {
          return null;
        }

        return {
          questionId,
          textAnswer,
          selectedOptions: [],
        };
      })
      .filter(Boolean);

    if (!answers.length) {
      return res.status(400).json({ message: '??? ????? ????? ????? ????? ??? ?????.' });
    }

    const response = await SurveyResponse.findOneAndUpdate(
      {
        surveyId: survey._id,
        respondentId: req.user.id,
      },
      {
        $set: {
          respondentRole: req.user.role,
          answers,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
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
    return res.status(500).json({ message: error.message || '???? ????? ?? ?????????.' });
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


