const Homework = require('../models/Homework');
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

const mapHomework = (item) => ({
  id: String(item._id),
  className: item.className,
  subject: item.subject,
  title: item.title,
  description: item.description || '',
  dueDate: item.dueDate,
  maxMarks: item.maxMarks,
  teacherId: String(item.teacherId),
  teacherName: item.teacherName || '',
  assignments: (item.assignments || []).map((assignment) => ({
    studentId: String(assignment.studentId),
    studentName: assignment.studentName || '',
    status: assignment.status,
    score: assignment.score,
    maxMarks: assignment.maxMarks,
    updatedAt: assignment.updatedAt,
  })),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getTeacherExams = async (req, res) => {
  try {
    const teacherClasses = req.user.classes || [];
    const teacherSubjects = req.user.subjects || [];

    if (!teacherClasses.length) {
      return res.json({ classes: [], subjects: teacherSubjects, homework: [] });
    }

    const [students, homeworkDocs] = await Promise.all([
      User.find(
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
        .lean(),
      Homework.find({
        teacherId: req.user.id,
        className: { $in: teacherClasses },
        subject: { $in: teacherSubjects },
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

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

    return res.json({
      classes: grouped,
      subjects: teacherSubjects,
      homework: homeworkDocs.map(mapHomework),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ?????? ??????????.' });
  }
};

const upsertExamMark = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || '').trim();
    const subject = normalizeSubject(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const rawScore = Number(req.body?.score);
    const maxMarks = Number(req.body?.maxMarks || 100);
    const examTitle = String(req.body?.examTitle || req.body?.title || '??????').trim();

    if (!studentId || !subject || Number.isNaN(rawScore) || Number.isNaN(maxMarks)) {
      return res.status(400).json({ message: '?????? ??????? ??????? ??????? ??????? ???? ??????.' });
    }

    if (maxMarks <= 0 || maxMarks > 1000) {
      return res.status(400).json({ message: '?????? ??????? ??? ?????.' });
    }

    if (rawScore < 0 || rawScore > maxMarks) {
      return res.status(400).json({ message: '???? ?????? ??? ?? ???? ??? 0 ??????? ???????.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: '????? ????? ????? ????? ???.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }

    const teacherClasses = req.user.classes || [];
    if (!hasClassAccess(teacherClasses, student.classes || [])) {
      return res.status(403).json({ message: '????? ????? ????? ???? ????? ???.' });
    }

    const normalizedScore = clamp((rawScore / maxMarks) * 100, 0, 100);

    const existingIndex = (student.examMarks || []).findIndex(
      (item) => String(item.subject || '').toLowerCase() === subject.toLowerCase()
    );

    const nextMark = {
      subject,
      examTitle,
      score: Number(normalizedScore.toFixed(2)),
      rawScore,
      maxMarks,
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
      message: '?? ????? ?????? ?????.',
      student: mapStudentForExamPanel(student.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??????.' });
  }
};

const deleteExamMark = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || '').trim();
    const subject = normalizeSubject(req.body?.subject);

    if (!studentId || !subject) {
      return res.status(400).json({ message: '?????? ??????? ???? ??????.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: '????? ????? ????? ????? ???.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }

    const teacherClasses = req.user.classes || [];
    if (!hasClassAccess(teacherClasses, student.classes || [])) {
      return res.status(403).json({ message: '????? ????? ????? ???? ????? ???.' });
    }

    const initialLength = (student.examMarks || []).length;
    student.examMarks = (student.examMarks || []).filter(
      (item) => String(item.subject || '').toLowerCase() !== subject.toLowerCase()
    );

    if (student.examMarks.length === initialLength) {
      return res.status(404).json({ message: '?? ???? ???? ???? ??????.' });
    }

    await student.save();

    return res.json({
      message: '?? ??? ?????? ?????.',
      student: mapStudentForExamPanel(student.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ??? ??????.' });
  }
};

const listTeacherHomework = async (req, res) => {
  try {
    const subject = normalizeSubject(req.query?.subject || req.user.subject || req.user.subjects?.[0]);
    const className = String(req.query?.className || '').trim();

    const query = {
      teacherId: req.user.id,
      subject,
      className: className || { $in: req.user.classes || [] },
    };

    const items = await Homework.find(query).sort({ createdAt: -1 }).lean();
    return res.json({ homework: items.map(mapHomework) });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ????????.' });
  }
};

const createHomework = async (req, res) => {
  try {
    const className = String(req.body?.className || '').trim();
    const subject = normalizeSubject(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const dueDate = req.body?.dueDate ? new Date(req.body.dueDate) : null;
    const maxMarks = Number(req.body?.maxMarks || 100);

    if (!className || !subject || !title) {
      return res.status(400).json({ message: '???? ??????? ???????? ???? ??????.' });
    }

    if (!req.user.classes?.includes(className)) {
      return res.status(403).json({ message: '????? ????? ????? ???.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: '????? ????? ????? ???.' });
    }

    if (Number.isNaN(maxMarks) || maxMarks <= 0 || maxMarks > 1000) {
      return res.status(400).json({ message: '?????? ??????? ??? ?????.' });
    }

    const students = await User.find(
      { role: 'student', classes: className },
      { _id: 1, name: 1 }
    ).lean();

    const created = await Homework.create({
      className,
      subject,
      title,
      description,
      dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
      maxMarks,
      teacherId: req.user.id,
      teacherName: req.user.name || '',
      assignments: students.map((student) => ({
        studentId: student._id,
        studentName: student.name,
        status: 'pending',
        score: null,
        maxMarks,
        updatedAt: new Date(),
      })),
    });

    await Promise.all(
      students.map((student) =>
        User.updateOne(
          { _id: student._id },
          {
            $push: {
              homework: {
                homeworkId: created._id,
                title,
                subject,
                status: 'pending',
                score: null,
                maxMarks,
                dueDate: created.dueDate,
                updatedAt: new Date(),
              },
            },
          }
        )
      )
    );

    return res.status(201).json({ homework: mapHomework(created.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??????.' });
  }
};

const updateHomeworkAssignment = async (req, res) => {
  try {
    const homeworkId = String(req.params.id || '').trim();
    const studentId = String(req.body?.studentId || '').trim();
    const status = String(req.body?.status || '').trim() || null;
    const score = req.body?.score === null || req.body?.score === '' ? null : Number(req.body?.score);

    if (!homeworkId || !studentId) {
      return res.status(400).json({ message: '?????? ??????? ???? ??????.' });
    }

    if (status && !['pending', 'submitted', 'graded'].includes(status)) {
      return res.status(400).json({ message: '???? ?????? ??? ?????.' });
    }

    if (score !== null && Number.isNaN(score)) {
      return res.status(400).json({ message: '???? ?????? ??? ?????.' });
    }

    const homework = await Homework.findOne({ _id: homeworkId, teacherId: req.user.id });
    if (!homework) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }

    if (!req.user.classes?.includes(homework.className)) {
      return res.status(403).json({ message: '????? ????? ????? ???.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], homework.subject)) {
      return res.status(403).json({ message: '????? ????? ????? ???.' });
    }

    const assignmentIndex = (homework.assignments || []).findIndex(
      (item) => String(item.studentId) === studentId
    );

    if (assignmentIndex < 0) {
      return res.status(404).json({ message: '?????? ??? ????? ???? ??????.' });
    }

    const target = homework.assignments[assignmentIndex];
    const nextStatus = status || target.status;
    const nextScore = score === null ? target.score : score;

    if (nextScore !== null && (nextScore < 0 || nextScore > homework.maxMarks)) {
      return res.status(400).json({ message: '???? ?????? ??? ?? ???? ??? ?????? ???????.' });
    }

    homework.assignments[assignmentIndex] = {
      ...target,
      status: nextStatus,
      score: nextScore,
      maxMarks: homework.maxMarks,
      updatedAt: new Date(),
    };

    await homework.save();

    await User.updateOne(
      { _id: studentId },
      {
        $set: {
          'homework.$[item].status': nextStatus,
          'homework.$[item].score': nextScore,
          'homework.$[item].maxMarks': homework.maxMarks,
          'homework.$[item].updatedAt': new Date(),
        },
      },
      {
        arrayFilters: [{ 'item.homeworkId': homework._id }],
      }
    );

    return res.json({ homework: mapHomework(homework.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??????.' });
  }
};

const deleteHomework = async (req, res) => {
  try {
    const homework = await Homework.findOneAndDelete({ _id: req.params.id, teacherId: req.user.id });
    if (!homework) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }

    await User.updateMany(
      {
        role: 'student',
      },
      {
        $pull: {
          homework: {
            homeworkId: homework._id,
          },
        },
      }
    );

    return res.json({ message: '?? ??? ??????.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ??? ??????.' });
  }
};

module.exports = {
  getTeacherExams,
  upsertExamMark,
  deleteExamMark,
  listTeacherHomework,
  createHomework,
  updateHomeworkAssignment,
  deleteHomework,
};


