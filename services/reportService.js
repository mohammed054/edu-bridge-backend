const ClassModel = require('../models/Class');
const Feedback = require('../models/Feedback');
const User = require('../models/User');

const buildSubmittedCounts = async (role) => {
  const grouped = await Feedback.aggregate([
    {
      $match: {
        senderRole: role,
        senderId: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$senderId',
        total: { $sum: 1 },
      },
    },
    {
      $sort: {
        total: -1,
      },
    },
  ]);

  if (!grouped.length) {
    return [];
  }

  const users = await User.find(
    { _id: { $in: grouped.map((item) => item._id) } },
    { name: 1, email: 1, role: 1 }
  ).lean();

  const userById = users.reduce((acc, item) => {
    acc[String(item._id)] = item;
    return acc;
  }, {});

  return grouped.map((item) => {
    const user = userById[String(item._id)];
    return {
      id: String(item._id),
      name: user?.name || 'Unknown user',
      email: user?.email || '',
      role: user?.role || role,
      total: item.total,
    };
  });
};

const buildReceivedStudentCounts = async () => {
  const grouped = await Feedback.aggregate([
    {
      $match: {
        studentId: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$studentId',
        total: { $sum: 1 },
      },
    },
    {
      $sort: {
        total: -1,
      },
    },
  ]);

  if (!grouped.length) {
    return [];
  }

  const students = await User.find(
    { _id: { $in: grouped.map((item) => item._id) }, role: 'student' },
    { name: 1, email: 1 }
  ).lean();

  const studentById = students.reduce((acc, item) => {
    acc[String(item._id)] = item;
    return acc;
  }, {});

  return grouped.map((item) => {
    const student = studentById[String(item._id)];
    return {
      id: String(item._id),
      name: student?.name || 'Unknown student',
      email: student?.email || '',
      total: item.total,
    };
  });
};

const buildAdminReports = async () => {
  const [classesCount, studentsCount, teachersCount, totalFeedbacks] = await Promise.all([
    ClassModel.countDocuments(),
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'teacher' }),
    Feedback.countDocuments(),
  ]);

  const [feedbackSubmittedPerStudent, feedbackSubmittedPerTeacher, feedbackReceivedPerStudent, students] =
    await Promise.all([
      buildSubmittedCounts('student'),
      buildSubmittedCounts('teacher'),
      buildReceivedStudentCounts(),
      User.find(
        { role: 'student' },
        { name: 1, email: 1, classes: 1, absentDays: 1, negativeReports: 1 }
      )
        .sort({ name: 1 })
        .lean(),
    ]);

  return {
    totals: {
      classes: classesCount,
      students: studentsCount,
      teachers: teachersCount,
      feedbacks: totalFeedbacks,
    },
    feedbackSubmittedPerStudent,
    feedbackSubmittedPerTeacher,
    feedbackReceivedPerStudent,
    attendanceAndBehaviorByStudent: students.map((student) => ({
      id: String(student._id),
      name: student.name,
      email: student.email || '',
      classes: student.classes || [],
      absentDays: Number(student.absentDays || 0),
      negativeReports: Number(student.negativeReports || 0),
    })),
  };
};

module.exports = {
  buildAdminReports,
};
