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
    return res.status(500).json({ message: error.message || 'تعذر تحميل بيانات الاختبارات.' });
  }
};

const upsertExamMark = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || '').trim();
    const subject = normalizeSubject(req.body?.subject);
    const score = Number(req.body?.score);

    if (!studentId || !subject || Number.isNaN(score)) {
      return res.status(400).json({ message: 'الطالب والمادة والدرجة حقول مطلوبة.' });
    }

    if (score < 0 || score > 100) {
      return res.status(400).json({ message: 'الدرجة يجب أن تكون بين 0 و100.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'يمكنك إدارة درجات مادتك فقط.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود.' });
    }

    const teacherClasses = req.user.classes || [];
    if (!hasClassAccess(teacherClasses, student.classes || [])) {
      return res
        .status(403)
        .json({ message: 'يمكنك تعديل درجات طلاب صفوفك فقط.' });
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
      message: 'تم تحديث الدرجة بنجاح.',
      student: mapStudentForExamPanel(student.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحديث الدرجة.' });
  }
};

const deleteExamMark = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || '').trim();
    const subject = normalizeSubject(req.body?.subject);

    if (!studentId || !subject) {
      return res.status(400).json({ message: 'الطالب والمادة حقول مطلوبة.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'يمكنك إدارة درجات مادتك فقط.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود.' });
    }

    const teacherClasses = req.user.classes || [];
    if (!hasClassAccess(teacherClasses, student.classes || [])) {
      return res
        .status(403)
        .json({ message: 'يمكنك تعديل درجات طلاب صفوفك فقط.' });
    }

    const initialLength = (student.examMarks || []).length;
    student.examMarks = (student.examMarks || []).filter(
      (item) => String(item.subject || '').toLowerCase() !== subject.toLowerCase()
    );

    if (student.examMarks.length === initialLength) {
      return res.status(404).json({ message: 'لا توجد درجة لهذه المادة.' });
    }

    await student.save();

    return res.json({
      message: 'تم حذف الدرجة بنجاح.',
      student: mapStudentForExamPanel(student.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر حذف الدرجة.' });
  }
};

module.exports = {
  getTeacherExams,
  upsertExamMark,
  deleteExamMark,
};
