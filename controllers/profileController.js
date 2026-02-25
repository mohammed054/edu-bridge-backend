const Feedback = require('../models/Feedback');
const User = require('../models/User');

const canTeacherAccessStudent = (teacherUser, studentUser) => {
  const teacherClasses = new Set(teacherUser?.classes || []);
  return (studentUser?.classes || []).some((className) => teacherClasses.has(className));
};

const buildMarksAnalysisPlaceholder = (examMarks) => ({
  implemented: false,
  message: 'AI analysis of marks is not implemented yet.',
  marksCount: examMarks.length,
});

const getStudentProfile = async (req, res) => {
  try {
    const { studentId } = req.params;
    const targetStudent = await User.findOne({ _id: studentId, role: 'student' }).lean();

    if (!targetStudent) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    if (req.user.role === 'student' && String(req.user.id) !== String(targetStudent._id)) {
      return res.status(403).json({ message: 'Students can only access their own profile.' });
    }

    if (req.user.role === 'teacher' && !canTeacherAccessStudent(req.user, targetStudent)) {
      return res
        .status(403)
        .json({ message: 'Teachers can only access students assigned to their classes.' });
    }

    if (!['student', 'teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    const feedbackReceived = await Feedback.find({
      studentId: targetStudent._id,
      feedbackType: { $in: ['teacher_feedback', 'admin_feedback'] },
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      student: {
        id: String(targetStudent._id),
        name: targetStudent.name,
        email: targetStudent.email || '',
        classes: targetStudent.classes || [],
      },
      absentDays: Number(targetStudent.absentDays || 0),
      negativeReports: Number(targetStudent.negativeReports || 0),
      examMarks: (targetStudent.examMarks || []).sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
      ),
      marksAnalysis: buildMarksAnalysisPlaceholder(targetStudent.examMarks || []),
      feedbackReceived: feedbackReceived.map((item) => ({
        id: String(item._id),
        feedbackType: item.feedbackType,
        senderRole: item.senderRole || item.senderType,
        teacherName: item.teacherName || '',
        adminName: item.adminName || '',
        className: item.className || '',
        content: item.content || item.message || '',
        tags: item.tags || [],
        notes: item.notes || '',
        suggestion: item.suggestion || '',
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load profile.' });
  }
};

module.exports = {
  getStudentProfile,
};
