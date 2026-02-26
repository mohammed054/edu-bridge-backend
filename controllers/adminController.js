const bcrypt = require('bcrypt');
const ClassModel = require('../models/Class');
const User = require('../models/User');
const { HIKMAH_SUBJECTS } = require('../constants/subjects');
const { buildAdminReports } = require('../services/reportService');
const {
  normalizeEmail,
  normalizeIdentifier,
  normalizeClasses,
  validateEmailByRole,
} = require('../utils/userValidation');

const SALT_ROUNDS = 10;

const normalizeSubjects = (subjects) => {
  if (!Array.isArray(subjects)) {
    return [];
  }
  return [...new Set(subjects.map((item) => String(item || '').trim()).filter(Boolean))];
};

const ensureClassesExist = async (classNames) => {
  for (const className of classNames) {
    // eslint-disable-next-line no-await-in-loop
    await ClassModel.updateOne(
      { name: className },
      { $setOnInsert: { name: className, grade: '', section: '' } },
      { upsert: true }
    );
  }
};

const resolveTeacherSubject = (subjects) => {
  const cleanSubjects = normalizeSubjects(subjects);
  if (!cleanSubjects.length) {
    return { error: 'يجب تعيين مادة واحدة للمعلم.' };
  }
  if (cleanSubjects.length > 1) {
    return { error: 'المعلم مرتبط بمادة واحدة فقط.' };
  }
  const [subject] = cleanSubjects;
  if (!HIKMAH_SUBJECTS.includes(subject)) {
    return { error: 'المادة غير متاحة ضمن مواد المدرسة.' };
  }
  return { subject };
};

const resolveStudentClass = (classes) => {
  const cleanClasses = normalizeClasses(classes);
  if (!cleanClasses.length) {
    return { error: 'يجب تعيين الطالب إلى صف واحد.' };
  }
  if (cleanClasses.length > 1) {
    return { error: 'لا يمكن تعيين الطالب لأكثر من صف.' };
  }
  return { className: cleanClasses[0] };
};

const buildUserPayload = async ({ role, name, email, password, classes, subjects }) => {
  const cleanName = normalizeIdentifier(name);
  const cleanPassword = String(password || '');
  const cleanEmail = normalizeEmail(email);
  const cleanClasses = normalizeClasses(classes);

  if (!cleanName) {
    return { error: 'الاسم مطلوب.' };
  }

  const emailError = validateEmailByRole(role, cleanEmail);
  if (emailError) {
    return { error: emailError };
  }

  if (!cleanPassword) {
    return { error: 'كلمة المرور مطلوبة.' };
  }

  let nextClasses = cleanClasses;
  let nextSubjects = [];

  if (role === 'student') {
    const { className, error } = resolveStudentClass(cleanClasses);
    if (error) {
      return { error };
    }
    nextClasses = [className];
  }

  if (role === 'teacher') {
    const { subject, error } = resolveTeacherSubject(subjects);
    if (error) {
      return { error };
    }
    nextSubjects = [subject];
  }

  await ensureClassesExist(nextClasses);

  const passwordHash = await bcrypt.hash(cleanPassword, SALT_ROUNDS);
  return {
    payload: {
      role,
      name: cleanName,
      email: cleanEmail,
      classes: nextClasses,
      subjects: nextSubjects,
      passwordHash,
    },
  };
};

const listOverview = async (_req, res) => {
  try {
    const [classes, teachers, students] = await Promise.all([
      ClassModel.find().sort({ name: 1 }).lean(),
      User.find({ role: 'teacher' }).sort({ name: 1 }).lean(),
      User.find({ role: 'student' }).sort({ name: 1 }).lean(),
    ]);

    const subjectsFromTeachers = teachers
      .flatMap((item) => item.subjects || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    const availableSubjects = [...new Set([...HIKMAH_SUBJECTS, ...subjectsFromTeachers])].sort((a, b) =>
      a.localeCompare(b, 'ar')
    );

    return res.json({
      classes: classes.map((item) => ({
        id: String(item._id),
        name: item.name,
      })),
      teachers: teachers.map((item) => ({
        id: String(item._id),
        name: item.name,
        email: item.email,
        avatarUrl: item.avatarUrl || '',
        classes: item.classes || [],
        subject: item.subjects?.[0] || '',
        subjects: item.subjects || [],
      })),
      students: students.map((item) => ({
        id: String(item._id),
        name: item.name,
        email: item.email,
        avatarUrl: item.avatarUrl || '',
        className: item.classes?.[0] || '',
        classes: item.classes || [],
        absentDays: Number(item.absentDays || 0),
        negativeReports: Number(item.negativeReports || 0),
      })),
      availableSubjects,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحميل بيانات الإدارة.' });
  }
};

const getReports = async (_req, res) => {
  try {
    const reports = await buildAdminReports();
    return res.json(reports);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحميل التقارير.' });
  }
};

const addTeacher = async (req, res) => {
  try {
    const { payload, error } = await buildUserPayload({
      role: 'teacher',
      name: req.body?.name,
      email: req.body?.email,
      password: req.body?.password,
      classes: req.body?.classes || [req.body?.className].filter(Boolean),
      subjects: req.body?.subjects || [req.body?.subject].filter(Boolean),
    });

    if (error) {
      return res.status(400).json({ message: error });
    }

    const exists = await User.findOne({ email: payload.email });
    if (exists) {
      return res.status(409).json({ message: 'المعلم موجود مسبقًا.' });
    }

    const user = await User.create(payload);
    return res.status(201).json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر إضافة المعلم.' });
  }
};

const addStudent = async (req, res) => {
  try {
    const { payload, error } = await buildUserPayload({
      role: 'student',
      name: req.body?.name,
      email: req.body?.email,
      password: req.body?.password,
      classes: req.body?.classes || [req.body?.className].filter(Boolean),
    });

    if (error) {
      return res.status(400).json({ message: error });
    }

    const exists = await User.findOne({ email: payload.email });
    if (exists) {
      return res.status(409).json({ message: 'الطالب موجود مسبقًا.' });
    }

    const user = await User.create(payload);
    return res.status(201).json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر إضافة الطالب.' });
  }
};

const removeTeacher = async (req, res) => {
  try {
    const deleted = await User.findOneAndDelete({
      _id: req.params.id,
      role: 'teacher',
    });

    if (!deleted) {
      return res.status(404).json({ message: 'المعلم غير موجود.' });
    }

    return res.json({ message: 'تم حذف المعلم.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر حذف المعلم.' });
  }
};

const removeStudent = async (req, res) => {
  try {
    const deleted = await User.findOneAndDelete({
      _id: req.params.id,
      role: 'student',
    });

    if (!deleted) {
      return res.status(404).json({ message: 'الطالب غير موجود.' });
    }

    return res.json({ message: 'تم حذف الطالب.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر حذف الطالب.' });
  }
};

const addClass = async (req, res) => {
  try {
    const className = normalizeIdentifier(req.body?.name);
    if (!className) {
      return res.status(400).json({ message: 'اسم الصف مطلوب.' });
    }

    const exists = await ClassModel.findOne({ name: className });
    if (exists) {
      return res.status(409).json({ message: 'الصف موجود مسبقًا.' });
    }

    const created = await ClassModel.create({
      name: className,
      grade: '',
      section: '',
    });

    return res.status(201).json({
      classItem: {
        id: String(created._id),
        name: created.name,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر إضافة الصف.' });
  }
};

const removeClass = async (req, res) => {
  try {
    const classItem = await ClassModel.findById(req.params.id);
    if (!classItem) {
      return res.status(404).json({ message: 'الصف غير موجود.' });
    }

    const studentsInClass = await User.countDocuments({
      role: 'student',
      classes: classItem.name,
    });
    if (studentsInClass > 0) {
      return res.status(400).json({
        message: 'لا يمكن حذف الصف لوجود طلاب مرتبطين به.',
      });
    }

    await ClassModel.deleteOne({ _id: classItem._id });
    await User.updateMany({ role: 'teacher' }, { $pull: { classes: classItem.name } });

    return res.json({ message: 'تم حذف الصف.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر حذف الصف.' });
  }
};

const updateTeacherAssignment = async (req, res) => {
  try {
    const classes = normalizeClasses(req.body?.classes || []);
    const subjects = req.body?.subject
      ? [req.body.subject]
      : Array.isArray(req.body?.subjects)
        ? req.body.subjects
        : [];
    const { subject, error } = resolveTeacherSubject(subjects);
    if (error) {
      return res.status(400).json({ message: error });
    }

    await ensureClassesExist(classes);

    const teacher = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'teacher' },
      {
        $set: {
          classes,
          subjects: [subject],
        },
      },
      { new: true }
    );

    if (!teacher) {
      return res.status(404).json({ message: 'المعلم غير موجود.' });
    }

    return res.json({ user: teacher.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحديث تعيين المعلم.' });
  }
};

const updateStudentAssignment = async (req, res) => {
  try {
    const classes = req.body?.className ? [req.body.className] : req.body?.classes || [];
    const { className, error } = resolveStudentClass(classes);
    if (error) {
      return res.status(400).json({ message: error });
    }

    await ensureClassesExist([className]);

    const student = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'student' },
      { $set: { classes: [className] } },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود.' });
    }

    return res.json({ user: student.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تحديث صف الطالب.' });
  }
};

const importUsers = async (req, res) => {
  try {
    const teachers = Array.isArray(req.body?.teachers) ? req.body.teachers : [];
    const students = Array.isArray(req.body?.students) ? req.body.students : [];

    let addedCount = 0;
    let skippedDuplicates = 0;
    const errors = [];

    const importBatch = async (role, users) => {
      for (const [index, entry] of users.entries()) {
        // eslint-disable-next-line no-await-in-loop
        const { payload, error } = await buildUserPayload({
          role,
          name: entry?.name,
          email: entry?.email,
          password: entry?.password,
          classes: entry?.classes,
          subjects: entry?.subjects,
        });

        if (error) {
          errors.push({
            role,
            index,
            email: normalizeEmail(entry?.email),
            message: error,
          });
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const exists = await User.findOne({ email: payload.email });
        if (exists) {
          skippedDuplicates += 1;
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await User.create(payload);
        addedCount += 1;
      }
    };

    await importBatch('teacher', teachers);
    await importBatch('student', students);

    return res.json({
      summary: {
        addedCount,
        skippedDuplicates,
        errors,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر استيراد المستخدمين.' });
  }
};

const exportUsers = async (_req, res) => {
  try {
    const [teachers, students] = await Promise.all([
      User.find({ role: 'teacher' }).sort({ name: 1 }).lean(),
      User.find({ role: 'student' }).sort({ name: 1 }).lean(),
    ]);

    return res.json({
      teachers: teachers.map((user) => ({
        email: user.email,
        name: user.name,
        password: '',
        classes: user.classes || [],
        subjects: user.subjects || [],
      })),
      students: students.map((user) => ({
        email: user.email,
        name: user.name,
        password: '',
        classes: user.classes || [],
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تصدير المستخدمين.' });
  }
};

module.exports = {
  listOverview,
  getReports,
  importUsers,
  exportUsers,
  addTeacher,
  addStudent,
  addClass,
  removeTeacher,
  removeStudent,
  removeClass,
  updateTeacherAssignment,
  updateStudentAssignment,
};
