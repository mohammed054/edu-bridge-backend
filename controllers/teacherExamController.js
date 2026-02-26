const User = require('../models/User');

const normalizeSubject = (value) => String(value || '').trim();

const hasClassAccess = (teacherClasses, studentClasses) => {
  const classSet = new Set(teacherClasses || []);
  return (studentClasses || []).some((name) => classSet.has(name));
};

const hasSubjectAccess = (teacherSubjects, subject) =>
  (teacherSubjects || []).some(
    (teacherSubject) => String(teacherSubject || '').toLowerCase() === String(subject || '').toLowerCase()
  );

const mapStudentForExamPanel = (student) => ({
  id: String(student._id),
  name: student.name,
  email: student.email || '',
  classes: student.classes || [],
  examMarks: (student.examMarks || []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
});

const getTeacherExams = async (req, res) => {
  try {
    const teacherClasses = req.user.classes || [];
    const teacherSubjects = req.user.subjects || [];

    if (!teacherClasses.length) {
      return res.json({ classes: [], subjects: teacherSubjects });
    }

    const students = await User.find(
      {
        role: 'student',
        classes: { $in: teacherClasses },
      },
      {
        name: 1,
        email: 1,
        classes: 1,
        examMarks: 1,
      }
    )
      .sort({ name: 1 })
      .lean();

    const grouped = teacherClasses.map((className) => ({
      name: className,
      students: students
        .filter((student) => (student.classes || []).includes(className))
        .map((student) => {
          const mapped = mapStudentForExamPanel(student);
          mapped.examMarks = mapped.examMarks.filter((mark) => hasSubjectAccess(teacherSubjects, mark.subject));
          return mapped;
        }),
    }));

    return res.json({ classes: grouped, subjects: teacherSubjects });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load teacher exams.' });
  }
};

const upsertExamMark = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || '').trim();
    const subject = normalizeSubject(req.body?.subject);
    const score = Number(req.body?.score);

    if (!studentId || !subject || Number.isNaN(score)) {
      return res.status(400).json({ message: 'studentId, subject, and score are required.' });
    }

    if (score < 0 || score > 100) {
      return res.status(400).json({ message: 'Score must be between 0 and 100.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'You can only manage marks in your assigned subjects.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const teacherClasses = req.user.classes || [];
    if (!hasClassAccess(teacherClasses, student.classes || [])) {
      return res
        .status(403)
        .json({ message: 'You can only update marks for students in your classes.' });
    }

    const existingIndex = (student.examMarks || []).findIndex(
      (item) => String(item.subject || '').toLowerCase() === subject.toLowerCase()
    );

    const nextMark = {
      subject,
      score,
      teacherId: req.user.id,
      teacherName: req.user.name || '',
      updatedAt: new Date(),
    };

    if (existingIndex >= 0) {
      student.examMarks[existingIndex] = nextMark;
    } else {
      student.examMarks.push(nextMark);
    }

    await student.save();

    return res.json({
      message: 'Exam mark updated successfully.',
      student: mapStudentForExamPanel(student.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update exam mark.' });
  }
};

const deleteExamMark = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || '').trim();
    const subject = normalizeSubject(req.body?.subject);

    if (!studentId || !subject) {
      return res.status(400).json({ message: 'studentId and subject are required.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'You can only manage marks in your assigned subjects.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const teacherClasses = req.user.classes || [];
    if (!hasClassAccess(teacherClasses, student.classes || [])) {
      return res
        .status(403)
        .json({ message: 'You can only update marks for students in your classes.' });
    }

    const initialLength = (student.examMarks || []).length;
    student.examMarks = (student.examMarks || []).filter(
      (item) => String(item.subject || '').toLowerCase() !== subject.toLowerCase()
    );

    if (student.examMarks.length === initialLength) {
      return res.status(404).json({ message: 'Mark not found for this subject.' });
    }

    await student.save();

    return res.json({
      message: 'Exam mark deleted successfully.',
      student: mapStudentForExamPanel(student.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to delete exam mark.' });
  }
};

module.exports = {
  getTeacherExams,
  upsertExamMark,
  deleteExamMark,
};
