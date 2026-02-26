const Feedback = require('../models/Feedback');
const Homework = require('../models/Homework');
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
  message: '????? ??????? ???????? ??? ???? ??????.',
  marksCount: examMarks.length,
});

const buildCategorySummary = (feedbackReceived) => {
  const base = FEEDBACK_CATEGORY_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});

  feedbackReceived.forEach((item) => {
    if (item.category && Object.prototype.hasOwnProperty.call(base, item.category)) {
      base[item.category] += 1;
    }

    (item.categories || []).forEach((categoryKey) => {
      if (Object.prototype.hasOwnProperty.call(base, categoryKey)) {
        base[categoryKey] += 1;
      }
    });
  });

  return base;
};

const mapHomeworkForStudent = (homeworkDocs, studentId) =>
  homeworkDocs.map((item) => {
    const assignment = (item.assignments || []).find(
      (entry) => String(entry.studentId) === String(studentId)
    );

    return {
      id: String(item._id),
      className: item.className,
      subject: item.subject,
      title: item.title,
      description: item.description || '',
      dueDate: item.dueDate,
      maxMarks: item.maxMarks,
      status: assignment?.status || 'pending',
      score: assignment?.score ?? null,
      assignmentUpdatedAt: assignment?.updatedAt || null,
      teacherId: item.teacherId ? String(item.teacherId) : '',
      teacherName: item.teacherName || '',
      createdAt: item.createdAt,
    };
  });

const getStudentProfile = async (req, res) => {
  try {
    const { studentId } = req.params;
    const subjectFilter = String(req.query?.subject || '').trim();
    const targetStudent = await User.findOne({ _id: studentId, role: 'student' }).lean();

    if (!targetStudent) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }

    if (req.user.role === 'student' && String(req.user.id) !== String(targetStudent._id)) {
      return res.status(403).json({ message: '???? ?????? ?????? ??? ???? ???.' });
    }

    if (req.user.role === 'teacher' && !canTeacherAccessStudent(req.user, targetStudent)) {
      return res.status(403).json({ message: '???? ?????? ?????? ????? ????? ???.' });
    }

    if (!['student', 'teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: '???? ???? ?????? ??????.' });
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

    const homeworkQuery = {
      className: { $in: targetStudent.classes || [] },
    };
    if (subjectFilter) {
      homeworkQuery.subject = subjectFilter;
    }

    const homeworkDocs = await Homework.find(homeworkQuery).sort({ createdAt: -1 }).lean();
    const homework = mapHomeworkForStudent(homeworkDocs, targetStudent._id).filter((item) => {
      if (!teacherRestricted) {
        return true;
      }
      return item.subject ? hasSubjectAccess(req.user.subjects || [], item.subject) : true;
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
          surveyName: surveyMap[String(item.surveyId)]?.name || '???????',
          surveyDescription: surveyMap[String(item.surveyId)]?.description || '',
          answers: item.answers || [],
          submittedAt: item.createdAt,
        }));
      }
    }

    return res.json({
      student: {
        id: String(targetStudent._id),
        name: targetStudent.name,
        email: targetStudent.email || '',
        classes: targetStudent.classes || [],
        profilePicture: targetStudent.profilePicture || targetStudent.avatarUrl || '',
        avatarUrl: targetStudent.profilePicture || targetStudent.avatarUrl || '',
      },
      absentDays: Number(targetStudent.absentDays || 0),
      negativeReports: Number(targetStudent.negativeReports || 0),
      examMarks,
      homework,
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
        category: item.category || '',
        subcategory: item.subcategory || '',
        categories: item.categories || [],
        categoryDetails: item.categoryDetails || {},
        AIAnalysis: item.AIAnalysis || {},
        content: item.content || item.message || item.text || '',
        tags: item.tags || [],
        notes: item.notes || '',
        suggestion: item.suggestion || '',
        createdAt: item.createdAt,
      })),
      surveyResponses,
      visibility: {
        teacherRestricted,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ????? ??????.' });
  }
};

module.exports = {
  getStudentProfile,
};


