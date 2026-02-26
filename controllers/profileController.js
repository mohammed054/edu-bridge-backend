const Feedback = require('../models/Feedback');
const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');
const { FEEDBACK_CATEGORY_KEYS } = require('../constants/feedbackCatalog');

const canTeacherAccessStudent = (teacherUser, studentUser) => {
  const teacherClasses = new Set(teacherUser?.classes || []);
  return (studentUser?.classes || []).some((className) => teacherClasses.has(className));
};

const hasSubjectAccess = (teacherSubjects, subject) =>
  (teacherSubjects || []).some(
    (teacherSubject) => String(teacherSubject || '').toLowerCase() === String(subject || '').toLowerCase()
  );

const buildMarksAnalysisPlaceholder = (examMarks) => ({
  implemented: false,
  message: 'تحليل الدرجات التفصيلي غير مفعل حالياً.',
  marksCount: examMarks.length,
});

const buildCategorySummary = (feedbackReceived) => {
  const base = FEEDBACK_CATEGORY_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});

  feedbackReceived.forEach((item) => {
    (item.categories || []).forEach((categoryKey) => {
      if (Object.prototype.hasOwnProperty.call(base, categoryKey)) {
        base[categoryKey] += 1;
      }
    });
  });

  return base;
};

const getStudentProfile = async (req, res) => {
  try {
    const { studentId } = req.params;
    const subjectFilter = String(req.query?.subject || '').trim();
    const targetStudent = await User.findOne({ _id: studentId, role: 'student' }).lean();

    if (!targetStudent) {
      return res.status(404).json({ message: 'الطالب غير موجود.' });
    }

    if (req.user.role === 'student' && String(req.user.id) !== String(targetStudent._id)) {
      return res.status(403).json({ message: 'يمكن للطالب الوصول إلى ملفه فقط.' });
    }

    if (req.user.role === 'teacher' && !canTeacherAccessStudent(req.user, targetStudent)) {
      return res.status(403).json({ message: 'يمكن للمعلم الوصول لطلاب صفوفه فقط.' });
    }

    if (!['student', 'teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'ليس لديك صلاحية الوصول.' });
    }

    const feedbackQuery = {
      studentId: targetStudent._id,
      feedbackType: { $in: ['teacher_feedback', 'admin_feedback'] },
    };
    if (subjectFilter) {
      feedbackQuery.subject = subjectFilter;
    }

    const feedbackReceivedRaw = await Feedback.find(feedbackQuery).sort({ createdAt: -1 }).lean();

    const teacherRestricted = req.user.role === 'teacher';

    const feedbackReceived = teacherRestricted
      ? feedbackReceivedRaw.filter((item) =>
          item.subject ? hasSubjectAccess(req.user.subjects || [], item.subject) : true
        )
      : feedbackReceivedRaw;

    const examMarksRaw = [...(targetStudent.examMarks || [])].sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
    const examMarks = examMarksRaw.filter((mark) => {
      if (subjectFilter && String(mark.subject || '').toLowerCase() !== subjectFilter.toLowerCase()) {
        return false;
      }
      if (teacherRestricted && mark.subject) {
        return hasSubjectAccess(req.user.subjects || [], mark.subject);
      }
      return true;
    });

    let surveyResponses = [];
    if (!teacherRestricted) {
      const responseDocs = await SurveyResponse.find({
        respondentId: targetStudent._id,
        respondentRole: 'student',
      })
        .sort({ createdAt: -1 })
        .lean();

      if (responseDocs.length) {
        const surveys = await Survey.find(
          { _id: { $in: responseDocs.map((item) => item.surveyId) } },
          { name: 1, description: 1, questions: 1 }
        ).lean();
        const surveyMap = surveys.reduce((acc, item) => {
          acc[String(item._id)] = item;
          return acc;
        }, {});

        surveyResponses = responseDocs.map((item) => ({
          id: String(item._id),
          surveyId: String(item.surveyId),
          surveyName: surveyMap[String(item.surveyId)]?.name || 'استطلاع',
          surveyDescription: surveyMap[String(item.surveyId)]?.description || '',
          answers: item.answers || [],
          submittedAt: item.createdAt,
        }));
      }
    }

    const responsePayload = {
      student: {
        id: String(targetStudent._id),
        name: targetStudent.name,
        email: targetStudent.email || '',
        classes: targetStudent.classes || [],
        avatarUrl: targetStudent.avatarUrl || '',
      },
      absentDays: Number(targetStudent.absentDays || 0),
      negativeReports: Number(targetStudent.negativeReports || 0),
      examMarks,
      marksAnalysis: buildMarksAnalysisPlaceholder(examMarks),
      categorySummary: buildCategorySummary(feedbackReceived),
      feedbackReceived: feedbackReceived.map((item) => ({
        id: String(item._id),
        feedbackType: item.feedbackType,
        senderRole: item.senderRole || item.senderType,
        teacherName: item.teacherName || '',
        adminName: item.adminName || '',
        className: item.className || '',
        subject: item.subject || '',
        categories: item.categories || [],
        categoryDetails: item.categoryDetails || {},
        content: item.content || item.message || '',
        tags: item.tags || [],
        notes: item.notes || '',
        suggestion: item.suggestion || '',
        createdAt: item.createdAt,
      })),
      surveyResponses,
      visibility: {
        teacherRestricted,
      },
    };

    return res.json(responsePayload);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحميل الملف الشخصي.' });
  }
};

module.exports = {
  getStudentProfile,
};
