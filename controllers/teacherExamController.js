const Announcement = require('../models/Announcement');
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
  attachmentName: item.attachmentName || '',
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
    teacherComment: assignment.teacherComment || '',
    submissionText: assignment.submissionText || '',
    submissionAttachment: assignment.submissionAttachment || '',
    submittedAt: assignment.submittedAt || null,
    updatedAt: assignment.updatedAt,
  })),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const mapAnnouncement = (item) => ({
  id: String(item._id),
  className: item.className,
  subject: item.subject,
  title: item.title,
  body: item.body || '',
  attachmentName: item.attachmentName || '',
  teacherId: String(item.teacherId),
  teacherName: item.teacherName || '',
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parseOptionalDate = (value) => {
  if (value === undefined) {
    return { hasValue: false, value: null };
  }

  if (value === null || value === '') {
    return { hasValue: true, value: null };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { hasValue: true, value: NaN };
  }

  return { hasValue: true, value: parsed };
};

const assertTeacherHomeworkAccess = (req, homework) => {
  if (!homework) {
    return { allowed: false, code: 404, message: 'الواجب غير موجود.' };
  }

  if (!req.user.classes?.includes(homework.className)) {
    return { allowed: false, code: 403, message: 'لا تملك صلاحية إدارة هذا الفصل.' };
  }

  if (!hasSubjectAccess(req.user.subjects || [], homework.subject)) {
    return { allowed: false, code: 403, message: 'لا تملك صلاحية إدارة هذه المادة.' };
  }

  return { allowed: true };
};

const assertTeacherAnnouncementAccess = (req, announcement) => {
  if (!announcement) {
    return { allowed: false, code: 404, message: 'الإعلان غير موجود.' };
  }

  if (!req.user.classes?.includes(announcement.className)) {
    return { allowed: false, code: 403, message: 'لا تملك صلاحية إدارة هذا الفصل.' };
  }

  if (!hasSubjectAccess(req.user.subjects || [], announcement.subject)) {
    return { allowed: false, code: 403, message: 'لا تملك صلاحية إدارة هذه المادة.' };
  }

  return { allowed: true };
};

const getTeacherExams = async (req, res) => {
  try {
    const teacherClasses = req.user.classes || [];
    const teacherSubjects = req.user.subjects || [];

    if (!teacherClasses.length) {
      return res.json({ classes: [], subjects: teacherSubjects, homework: [], announcements: [] });
    }

    const homeworkQuery = {
      teacherId: req.user.id,
      className: { $in: teacherClasses },
    };

    const announcementQuery = {
      teacherId: req.user.id,
      className: { $in: teacherClasses },
    };

    if (teacherSubjects.length) {
      homeworkQuery.subject = { $in: teacherSubjects };
      announcementQuery.subject = { $in: teacherSubjects };
    }

    const [students, homeworkDocs, announcementDocs] = await Promise.all([
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
      Homework.find(homeworkQuery).sort({ createdAt: -1 }).lean(),
      Announcement.find(announcementQuery).sort({ createdAt: -1 }).lean(),
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
      announcements: announcementDocs.map(mapAnnouncement),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحميل بيانات المعلم.' });
  }
};

const upsertExamMark = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || '').trim();
    const subject = normalizeSubject(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const rawScore = Number(req.body?.score);
    const maxMarks = Number(req.body?.maxMarks || 100);
    const examTitle = String(req.body?.examTitle || req.body?.title || 'اختبار').trim();

    if (!studentId || !subject || Number.isNaN(rawScore) || Number.isNaN(maxMarks)) {
      return res.status(400).json({ message: 'بيانات الدرجة غير مكتملة.' });
    }

    if (maxMarks <= 0 || maxMarks > 1000) {
      return res.status(400).json({ message: 'الدرجة الكاملة غير صحيحة.' });
    }

    if (rawScore < 0 || rawScore > maxMarks) {
      return res.status(400).json({ message: 'درجة الطالب يجب أن تكون ضمن النطاق الصحيح.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذه المادة.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود.' });
    }

    const teacherClasses = req.user.classes || [];
    if (!hasClassAccess(teacherClasses, student.classes || [])) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذا الطالب.' });
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
      message: 'تم حفظ الدرجة بنجاح.',
      student: mapStudentForExamPanel(student.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر حفظ الدرجة.' });
  }
};

const deleteExamMark = async (req, res) => {
  try {
    const studentId = String(req.body?.studentId || '').trim();
    const subject = normalizeSubject(req.body?.subject);

    if (!studentId || !subject) {
      return res.status(400).json({ message: 'بيانات الحذف غير مكتملة.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذه المادة.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود.' });
    }

    const teacherClasses = req.user.classes || [];
    if (!hasClassAccess(teacherClasses, student.classes || [])) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذا الطالب.' });
    }

    const initialLength = (student.examMarks || []).length;
    student.examMarks = (student.examMarks || []).filter(
      (item) => String(item.subject || '').toLowerCase() !== subject.toLowerCase()
    );

    if (student.examMarks.length === initialLength) {
      return res.status(404).json({ message: 'لا توجد درجة مسجلة لهذه المادة.' });
    }

    await student.save();

    return res.json({
      message: 'تم حذف الدرجة.',
      student: mapStudentForExamPanel(student.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر حذف الدرجة.' });
  }
};

const listTeacherHomework = async (req, res) => {
  try {
    const className = String(req.query?.className || '').trim();
    const subject = normalizeSubject(req.query?.subject);

    if (className && !req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذا الفصل.' });
    }

    if (subject && !hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذه المادة.' });
    }

    const query = {
      teacherId: req.user.id,
      className: className || { $in: req.user.classes || [] },
    };

    if (subject) {
      query.subject = subject;
    } else if ((req.user.subjects || []).length) {
      query.subject = { $in: req.user.subjects || [] };
    }

    const items = await Homework.find(query).sort({ createdAt: -1 }).lean();
    return res.json({ homework: items.map(mapHomework) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحميل الواجبات.' });
  }
};

const createHomework = async (req, res) => {
  try {
    const className = String(req.body?.className || '').trim();
    const subject = normalizeSubject(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const attachmentName = String(req.body?.attachmentName || '').trim();
    const dueDate = req.body?.dueDate ? new Date(req.body.dueDate) : null;
    const maxMarks = Number(req.body?.maxMarks || 100);

    if (!className || !subject || !title) {
      return res.status(400).json({ message: 'البيانات الأساسية للواجب مطلوبة.' });
    }

    if (!req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذا الفصل.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذه المادة.' });
    }

    if (Number.isNaN(maxMarks) || maxMarks <= 0 || maxMarks > 1000) {
      return res.status(400).json({ message: 'الدرجة الكاملة غير صحيحة.' });
    }

    const students = await User.find({ role: 'student', classes: className }, { _id: 1, name: 1 }).lean();

    const created = await Homework.create({
      className,
      subject,
      title,
      description,
      attachmentName,
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
    return res.status(500).json({ message: error.message || 'تعذر إنشاء الواجب.' });
  }
};

const updateHomework = async (req, res) => {
  try {
    const homework = await Homework.findOne({ _id: req.params.id, teacherId: req.user.id });
    const access = assertTeacherHomeworkAccess(req, homework);
    if (!access.allowed) {
      return res.status(access.code).json({ message: access.message });
    }

    const title = req.body?.title !== undefined ? String(req.body.title || '').trim() : undefined;
    const description =
      req.body?.description !== undefined ? String(req.body.description || '').trim() : undefined;
    const attachmentName =
      req.body?.attachmentName !== undefined ? String(req.body.attachmentName || '').trim() : undefined;
    const maxMarks = req.body?.maxMarks !== undefined ? Number(req.body.maxMarks) : undefined;
    const dueDate = parseOptionalDate(req.body?.dueDate);

    if (title !== undefined && !title) {
      return res.status(400).json({ message: 'عنوان الواجب مطلوب.' });
    }

    if (maxMarks !== undefined && (Number.isNaN(maxMarks) || maxMarks <= 0 || maxMarks > 1000)) {
      return res.status(400).json({ message: 'الدرجة الكاملة غير صحيحة.' });
    }

    if (dueDate.hasValue && Number.isNaN(dueDate.value)) {
      return res.status(400).json({ message: 'تاريخ التسليم غير صالح.' });
    }

    if (title !== undefined) {
      homework.title = title;
    }

    if (description !== undefined) {
      homework.description = description;
    }

    if (attachmentName !== undefined) {
      homework.attachmentName = attachmentName;
    }

    if (maxMarks !== undefined) {
      homework.maxMarks = maxMarks;
      homework.assignments = (homework.assignments || []).map((item) => ({
        ...item,
        maxMarks,
        score:
          item.score === null || item.score === undefined
            ? null
            : Number(clamp(Number(item.score || 0), 0, maxMarks).toFixed(2)),
      }));
    }

    if (dueDate.hasValue) {
      homework.dueDate = dueDate.value;
    }

    await homework.save();

    await User.updateMany(
      { role: 'student' },
      {
        $set: {
          'homework.$[item].title': homework.title,
          'homework.$[item].subject': homework.subject,
          'homework.$[item].maxMarks': homework.maxMarks,
          ...(dueDate.hasValue ? { 'homework.$[item].dueDate': homework.dueDate } : {}),
          'homework.$[item].updatedAt': new Date(),
        },
      },
      {
        arrayFilters: [{ 'item.homeworkId': homework._id }],
      }
    );

    return res.json({ homework: mapHomework(homework.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحديث الواجب.' });
  }
};

const updateHomeworkAssignment = async (req, res) => {
  try {
    const homeworkId = String(req.params.id || '').trim();
    const studentId = String(req.body?.studentId || '').trim();
    const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'status');
    const hasScore = Object.prototype.hasOwnProperty.call(req.body || {}, 'score');
    const hasTeacherComment = Object.prototype.hasOwnProperty.call(req.body || {}, 'teacherComment');
    const status = hasStatus ? String(req.body?.status || '').trim() : null;
    const score = hasScore
      ? req.body?.score === null || req.body?.score === ''
        ? null
        : Number(req.body?.score)
      : null;
    const teacherComment = hasTeacherComment ? String(req.body?.teacherComment || '').trim() : '';

    if (!homeworkId || !studentId) {
      return res.status(400).json({ message: 'بيانات التحديث غير مكتملة.' });
    }

    if (hasStatus && status && !['pending', 'submitted', 'graded'].includes(status)) {
      return res.status(400).json({ message: 'حالة التسليم غير صحيحة.' });
    }

    if (hasScore && score !== null && Number.isNaN(score)) {
      return res.status(400).json({ message: 'درجة الواجب غير صحيحة.' });
    }

    const homework = await Homework.findOne({ _id: homeworkId, teacherId: req.user.id });
    const access = assertTeacherHomeworkAccess(req, homework);
    if (!access.allowed) {
      return res.status(access.code).json({ message: access.message });
    }

    const assignmentIndex = (homework.assignments || []).findIndex(
      (item) => String(item.studentId) === studentId
    );

    if (assignmentIndex < 0) {
      return res.status(404).json({ message: 'هذا الطالب غير موجود ضمن هذا الواجب.' });
    }

    const target = homework.assignments[assignmentIndex];
    const nextStatus = hasStatus && status ? status : target.status;
    const nextScore = hasScore ? score : target.score;
    const nextTeacherComment = hasTeacherComment ? teacherComment : target.teacherComment || '';

    if (nextScore !== null && (nextScore < 0 || nextScore > homework.maxMarks)) {
      return res.status(400).json({ message: 'درجة الواجب يجب أن تكون ضمن النطاق الصحيح.' });
    }

    homework.assignments[assignmentIndex] = {
      ...target,
      status: nextStatus,
      score: nextScore,
      maxMarks: homework.maxMarks,
      teacherComment: nextTeacherComment,
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
    return res.status(500).json({ message: error.message || 'تعذر تحديث الواجب.' });
  }
};

const deleteHomework = async (req, res) => {
  try {
    const homework = await Homework.findOneAndDelete({ _id: req.params.id, teacherId: req.user.id });
    if (!homework) {
      return res.status(404).json({ message: 'الواجب غير موجود.' });
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

    return res.json({ message: 'تم حذف الواجب.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر حذف الواجب.' });
  }
};

const listTeacherAnnouncements = async (req, res) => {
  try {
    const className = String(req.query?.className || '').trim();
    const subject = normalizeSubject(req.query?.subject);

    if (className && !req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذا الفصل.' });
    }

    if (subject && !hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذه المادة.' });
    }

    const query = {
      teacherId: req.user.id,
      className: className || { $in: req.user.classes || [] },
    };

    if (subject) {
      query.subject = subject;
    } else if ((req.user.subjects || []).length) {
      query.subject = { $in: req.user.subjects || [] };
    }

    const docs = await Announcement.find(query).sort({ createdAt: -1 }).lean();
    return res.json({ announcements: docs.map(mapAnnouncement) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحميل الإعلانات.' });
  }
};

const createTeacherAnnouncement = async (req, res) => {
  try {
    const className = String(req.body?.className || '').trim();
    const subject = normalizeSubject(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    const attachmentName = String(req.body?.attachmentName || '').trim();

    if (!className || !subject || !title) {
      return res.status(400).json({ message: 'بيانات الإعلان غير مكتملة.' });
    }

    if (!req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذا الفصل.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'لا تملك صلاحية إدارة هذه المادة.' });
    }

    const created = await Announcement.create({
      className,
      subject,
      title,
      body,
      attachmentName,
      teacherId: req.user.id,
      teacherName: req.user.name || '',
    });

    return res.status(201).json({ announcement: mapAnnouncement(created.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر إنشاء الإعلان.' });
  }
};

const updateTeacherAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      teacherId: req.user.id,
    });

    const access = assertTeacherAnnouncementAccess(req, announcement);
    if (!access.allowed) {
      return res.status(access.code).json({ message: access.message });
    }

    if (req.body?.title !== undefined) {
      const title = String(req.body?.title || '').trim();
      if (!title) {
        return res.status(400).json({ message: 'عنوان الإعلان مطلوب.' });
      }
      announcement.title = title;
    }

    if (req.body?.body !== undefined) {
      announcement.body = String(req.body?.body || '').trim();
    }

    if (req.body?.attachmentName !== undefined) {
      announcement.attachmentName = String(req.body?.attachmentName || '').trim();
    }

    await announcement.save();
    return res.json({ announcement: mapAnnouncement(announcement.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحديث الإعلان.' });
  }
};

const deleteTeacherAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findOneAndDelete({
      _id: req.params.id,
      teacherId: req.user.id,
    });

    if (!announcement) {
      return res.status(404).json({ message: 'الإعلان غير موجود.' });
    }

    return res.json({ message: 'تم حذف الإعلان.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر حذف الإعلان.' });
  }
};

module.exports = {
  getTeacherExams,
  upsertExamMark,
  deleteExamMark,
  listTeacherHomework,
  createHomework,
  updateHomework,
  updateHomeworkAssignment,
  deleteHomework,
  listTeacherAnnouncements,
  createTeacherAnnouncement,
  updateTeacherAnnouncement,
  deleteTeacherAnnouncement,
};
