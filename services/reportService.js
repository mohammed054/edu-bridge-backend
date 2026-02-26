const ClassModel = require('../models/Class');
const Feedback = require('../models/Feedback');
const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');
const { FEEDBACK_CATEGORY_KEYS } = require('../constants/feedbackCatalog');

const buildFeedbackTotalsByStudent = async () => {
  const grouped = await Feedback.aggregate([
    { $match: { studentId: { $ne: null } } },
    { $group: { _id: '$studentId', total: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);

  if (!grouped.length) {
    return [];
  }

  const students = await User.find(
    { _id: { $in: grouped.map((item) => item._id) }, role: 'student' },
    { name: 1, email: 1, classes: 1 }
  ).lean();

  const studentById = students.reduce((acc, item) => {
    acc[String(item._id)] = item;
    return acc;
  }, {});

  return grouped.map((item) => ({
    id: String(item._id),
    name: studentById[String(item._id)]?.name || 'طالب غير معروف',
    email: studentById[String(item._id)]?.email || '',
    classes: studentById[String(item._id)]?.classes || [],
    total: item.total,
  }));
};

const buildFeedbackTotalsByTeacher = async () => {
  const grouped = await Feedback.aggregate([
    { $match: { teacherId: { $ne: null } } },
    { $group: { _id: '$teacherId', total: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);

  if (!grouped.length) {
    return [];
  }

  const teachers = await User.find(
    { _id: { $in: grouped.map((item) => item._id) }, role: 'teacher' },
    { name: 1, email: 1, classes: 1, subjects: 1 }
  ).lean();

  const teacherById = teachers.reduce((acc, item) => {
    acc[String(item._id)] = item;
    return acc;
  }, {});

  return grouped.map((item) => ({
    id: String(item._id),
    name: teacherById[String(item._id)]?.name || 'معلم غير معروف',
    email: teacherById[String(item._id)]?.email || '',
    classes: teacherById[String(item._id)]?.classes || [],
    subjects: teacherById[String(item._id)]?.subjects || [],
    total: item.total,
  }));
};

const buildFeedbackTotalsByClass = async () => {
  const grouped = await Feedback.aggregate([
    { $match: { className: { $ne: '' } } },
    { $group: { _id: '$className', total: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);

  return grouped.map((item) => ({
    className: item._id || 'غير محدد',
    total: item.total,
  }));
};

const buildCategoryBreakdown = async () => {
  const grouped = await Feedback.aggregate([
    { $unwind: { path: '$categories', preserveNullAndEmptyArrays: false } },
    { $group: { _id: '$categories', total: { $sum: 1 } } },
  ]);

  const base = FEEDBACK_CATEGORY_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});

  grouped.forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(base, item._id)) {
      base[item._id] = item.total;
    }
  });

  return base;
};

const buildAttendanceBehaviorByStudent = async () => {
  const students = await User.find(
    { role: 'student' },
    { name: 1, email: 1, classes: 1, absentDays: 1, negativeReports: 1 }
  )
    .sort({ name: 1 })
    .lean();

  return students.map((student) => ({
    id: String(student._id),
    name: student.name,
    email: student.email || '',
    classes: student.classes || [],
    absentDays: Number(student.absentDays || 0),
    negativeReports: Number(student.negativeReports || 0),
  }));
};

const buildExamSummaryByClass = async () => {
  const students = await User.find({ role: 'student' }, { classes: 1, examMarks: 1 }).lean();
  const classMap = {};

  students.forEach((student) => {
    const marks = student.examMarks || [];
    (student.classes || []).forEach((className) => {
      if (!classMap[className]) {
        classMap[className] = {
          className,
          marksCount: 0,
          averageScore: 0,
          subjects: {},
        };
      }

      marks.forEach((mark) => {
        classMap[className].marksCount += 1;
        classMap[className].averageScore += Number(mark.score || 0);
        if (!classMap[className].subjects[mark.subject]) {
          classMap[className].subjects[mark.subject] = { total: 0, count: 0 };
        }
        classMap[className].subjects[mark.subject].total += Number(mark.score || 0);
        classMap[className].subjects[mark.subject].count += 1;
      });
    });
  });

  return Object.values(classMap).map((item) => {
    const subjectSummary = Object.entries(item.subjects).map(([subject, scoreData]) => ({
      subject,
      averageScore: scoreData.count ? Number((scoreData.total / scoreData.count).toFixed(2)) : 0,
      count: scoreData.count,
    }));
    return {
      className: item.className,
      marksCount: item.marksCount,
      averageScore: item.marksCount ? Number((item.averageScore / item.marksCount).toFixed(2)) : 0,
      subjectSummary: subjectSummary.sort((a, b) => b.count - a.count),
    };
  });
};

const buildSurveySummary = async () => {
  const surveys = await Survey.find({}, { name: 1, description: 1, audience: 1, isActive: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .lean();

  if (!surveys.length) {
    return [];
  }

  const responseCounts = await SurveyResponse.aggregate([
    { $group: { _id: '$surveyId', totalResponses: { $sum: 1 } } },
  ]);

  const countsBySurvey = responseCounts.reduce((acc, item) => {
    acc[String(item._id)] = item.totalResponses;
    return acc;
  }, {});

  return surveys.map((survey) => ({
    id: String(survey._id),
    name: survey.name,
    description: survey.description || '',
    audience: survey.audience || [],
    isActive: Boolean(survey.isActive),
    totalResponses: countsBySurvey[String(survey._id)] || 0,
    createdAt: survey.createdAt,
  }));
};

const buildAdminReports = async () => {
  const [classesCount, studentsCount, teachersCount, totalFeedbacks] = await Promise.all([
    ClassModel.countDocuments(),
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'teacher' }),
    Feedback.countDocuments(),
  ]);

  const [
    feedbackTotalsByStudent,
    feedbackTotalsByTeacher,
    feedbackTotalsByClass,
    categoryBreakdown,
    attendanceAndBehaviorByStudent,
    examSummaryByClass,
    surveys,
  ] = await Promise.all([
    buildFeedbackTotalsByStudent(),
    buildFeedbackTotalsByTeacher(),
    buildFeedbackTotalsByClass(),
    buildCategoryBreakdown(),
    buildAttendanceBehaviorByStudent(),
    buildExamSummaryByClass(),
    buildSurveySummary(),
  ]);

  return {
    totals: {
      classes: classesCount,
      students: studentsCount,
      teachers: teachersCount,
      feedbacks: totalFeedbacks,
    },
    feedbackTotalsByStudent,
    feedbackTotalsByTeacher,
    feedbackTotalsByClass,
    categoryBreakdown,
    attendanceAndBehaviorByStudent,
    examSummaryByClass,
    surveys,
  };
};

module.exports = {
  buildAdminReports,
};
