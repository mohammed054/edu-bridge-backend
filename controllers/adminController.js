const bcrypt = require('bcrypt');
const ClassModel = require('../models/Class');
const Subject = require('../models/Subject');
const User = require('../models/User');
const Report = require('../models/Report');
const { HIKMAH_SUBJECTS } = require('../constants/subjects');
const { buildAdminReports } = require('../services/reportService');
const {
  normalizeEmail,
  normalizeIdentifier,
  normalizeClasses,
  normalizeSubjects,
  validateEmailByRole,
} = require('../utils/userValidation');

const SALT_ROUNDS = 10;

const ensureClassesExist = async (classNames) => {
  for (const className of classNames) {
    // eslint-disable-next-line no-await-in-loop
    await ClassModel.updateOne(
      { name: className },
      { $setOnInsert: { name: className, grade: '', section: '', teachers: [], subjects: [] } },
      { upsert: true }
    );
  }
};

const ensureSubjectExists = async (subjectName) => {
  if (!subjectName) {
    return;
  }
  await Subject.updateOne(
    { name: subjectName },
    { $setOnInsert: { name: subjectName, maxMarks: 100 } },
    { upsert: true }
  );
};

const resolveTeacherSubject = (subjects) => {
  const cleanSubjects = normalizeSubjects(subjects);
  if (!cleanSubjects.length) {
    return { error: '??? ????? ???? ????? ??????.' };
  }

  const [subject] = cleanSubjects;
  if (!HIKMAH_SUBJECTS.includes(subject)) {
    return { error: '?????? ??? ????? ??? ???? ???????.' };
  }

  return { subject };
};

const resolveStudentClass = (classes) => {
  const cleanClasses = normalizeClasses(classes);
  if (!cleanClasses.length) {
    return { error: '??? ????? ?????? ??? ?? ????.' };
  }

  return { className: cleanClasses[0] };
};

const syncTeacherInClasses = async ({ teacherId, classNames, subject }) => {
  await ClassModel.updateMany(
    { teachers: teacherId, name: { $nin: classNames } },
    { $pull: { teachers: teacherId } }
  );

  await ClassModel.updateMany(
    { name: { $in: classNames } },
    {
      $addToSet: {
        teachers: teacherId,
        subjects: subject,
      },
    }
  );
};

const buildUserPayload = async ({ role, name, email, password, classes, subjects, profilePicture }) => {
  const cleanName = normalizeIdentifier(name);
  const cleanPassword = String(password || '');
  const cleanEmail = normalizeEmail(email);
  const cleanClasses = normalizeClasses(classes);
  const cleanProfilePicture = String(profilePicture || '').trim();

  if (!cleanName) {
    return { error: '????? ?????.' };
  }

  const emailError = validateEmailByRole(role, cleanEmail);
  if (emailError) {
    return { error: emailError };
  }

  if (!cleanPassword) {
    return { error: '???? ?????? ??????.' };
  }

  let nextClasses = cleanClasses;
  let subject = '';

  if (role === 'student') {
    const { className, error } = resolveStudentClass(cleanClasses);
    if (error) {
      return { error };
    }
    nextClasses = [className];
  }

  if (role === 'teacher') {
    const subjectResolve = resolveTeacherSubject(subjects);
    if (subjectResolve.error) {
      return { error: subjectResolve.error };
    }
    subject = subjectResolve.subject;
  }

  await ensureClassesExist(nextClasses);
  if (subject) {
    await ensureSubjectExists(subject);
  }

  const passwordHash = await bcrypt.hash(cleanPassword, SALT_ROUNDS);
  return {
    payload: {
      role,
      name: cleanName,
      email: cleanEmail,
      classes: nextClasses,
      subject,
      subjects: subject ? [subject] : [],
      profilePicture: cleanProfilePicture,
      avatarUrl: cleanProfilePicture,
      passwordHash,
    },
  };
};

const mapClassPayload = (item) => ({
  id: String(item._id),
  name: item.name,
  grade: item.grade || '',
  section: item.section || '',
});

const mapTeacherPayload = (item) => ({
  id: String(item._id),
  name: item.name,
  email: item.email,
  profilePicture: item.profilePicture || item.avatarUrl || '',
  avatarUrl: item.profilePicture || item.avatarUrl || '',
  classes: item.classes || [],
  subject: item.subject || item.subjects?.[0] || '',
  subjects: item.subject ? [item.subject] : item.subjects || [],
});

const mapStudentPayload = (item) => ({
  id: String(item._id),
  name: item.name,
  email: item.email,
  profilePicture: item.profilePicture || item.avatarUrl || '',
  avatarUrl: item.profilePicture || item.avatarUrl || '',
  className: item.classes?.[0] || '',
  classes: item.classes || [],
  absentDays: Number(item.absentDays || 0),
  negativeReports: Number(item.negativeReports || 0),
});

const listOverview = async (_req, res) => {
  try {
    const [classes, teachers, students, subjects] = await Promise.all([
      ClassModel.find().sort({ name: 1 }).lean(),
      User.find({ role: 'teacher' }).sort({ name: 1 }).lean(),
      User.find({ role: 'student' }).sort({ name: 1 }).lean(),
      Subject.find().sort({ name: 1 }).lean(),
    ]);

    const availableSubjects = [...new Set([...HIKMAH_SUBJECTS, ...subjects.map((item) => item.name)])];

    return res.json({
      classes: classes.map(mapClassPayload),
      teachers: teachers.map(mapTeacherPayload),
      students: students.map(mapStudentPayload),
      availableSubjects,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ?????? ???????.' });
  }
};

const getReports = async (req, res) => {
  try {
    const reports = await buildAdminReports();

    // Snapshot for historical admin reports.
    await Report.create({
      generatedBy: req.user.id,
      type: 'admin_aggregate',
      payload: reports,
    });

    return res.json(reports);
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ????????.' });
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
      profilePicture: req.body?.profilePicture,
    });

    if (error) {
      return res.status(400).json({ message: error });
    }

    const exists = await User.findOne({ email: payload.email });
    if (exists) {
      return res.status(409).json({ message: '?????? ????? ??????.' });
    }

    const user = await User.create(payload);
    await syncTeacherInClasses({
      teacherId: user._id,
      classNames: user.classes || [],
      subject: user.subject || user.subjects?.[0] || '',
    });

    return res.status(201).json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??????.' });
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
      profilePicture: req.body?.profilePicture,
    });

    if (error) {
      return res.status(400).json({ message: error });
    }

    const exists = await User.findOne({ email: payload.email });
    if (exists) {
      return res.status(409).json({ message: '?????? ????? ??????.' });
    }

    const user = await User.create(payload);
    return res.status(201).json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??????.' });
  }
};

const removeTeacher = async (req, res) => {
  try {
    const deleted = await User.findOneAndDelete({
      _id: req.params.id,
      role: 'teacher',
    });

    if (!deleted) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }

    await ClassModel.updateMany({ teachers: deleted._id }, { $pull: { teachers: deleted._id } });

    return res.json({ message: '?? ??? ??????.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ??? ??????.' });
  }
};

const removeStudent = async (req, res) => {
  try {
    const deleted = await User.findOneAndDelete({
      _id: req.params.id,
      role: 'student',
    });

    if (!deleted) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }

    return res.json({ message: '?? ??? ??????.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ??? ??????.' });
  }
};

const addClass = async (req, res) => {
  try {
    const className = normalizeIdentifier(req.body?.name);
    const grade = normalizeIdentifier(req.body?.grade);
    const section = normalizeIdentifier(req.body?.section);

    if (!className) {
      return res.status(400).json({ message: '??? ???? ?????.' });
    }

    const exists = await ClassModel.findOne({ name: className });
    if (exists) {
      return res.status(409).json({ message: '???? ????? ??????.' });
    }

    const created = await ClassModel.create({
      name: className,
      grade,
      section,
      teachers: [],
      subjects: [],
    });

    return res.status(201).json({
      classItem: mapClassPayload(created),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ????.' });
  }
};

const removeClass = async (req, res) => {
  try {
    const classItem = await ClassModel.findById(req.params.id);
    if (!classItem) {
      return res.status(404).json({ message: '???? ??? ?????.' });
    }

    const studentsInClass = await User.countDocuments({
      role: 'student',
      classes: classItem.name,
    });
    if (studentsInClass > 0) {
      return res.status(400).json({
        message: '?? ???? ??? ???? ????? ???? ??????? ??.',
      });
    }

    await ClassModel.deleteOne({ _id: classItem._id });
    await User.updateMany({ role: 'teacher' }, { $pull: { classes: classItem.name } });

    return res.json({ message: '?? ??? ????.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ??? ????.' });
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

    const subjectResolve = resolveTeacherSubject(subjects);
    if (subjectResolve.error) {
      return res.status(400).json({ message: subjectResolve.error });
    }

    await ensureClassesExist(classes);
    await ensureSubjectExists(subjectResolve.subject);

    const teacher = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'teacher' },
      {
        $set: {
          classes,
          subject: subjectResolve.subject,
          subjects: [subjectResolve.subject],
        },
      },
      { new: true }
    );

    if (!teacher) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }

    await syncTeacherInClasses({
      teacherId: teacher._id,
      classNames: classes,
      subject: subjectResolve.subject,
    });

    return res.json({ user: teacher.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ????? ??????.' });
  }
};

const updateStudentAssignment = async (req, res) => {
  try {
    const classes = req.body?.className ? [req.body.className] : req.body?.classes || [];
    const classResolve = resolveStudentClass(classes);
    if (classResolve.error) {
      return res.status(400).json({ message: classResolve.error });
    }

    await ensureClassesExist([classResolve.className]);

    const student = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'student' },
      { $set: { classes: [classResolve.className] } },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }

    return res.json({ user: student.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ?? ??????.' });
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
          profilePicture: entry?.profilePicture,
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
        const created = await User.create(payload);
        if (role === 'teacher') {
          // eslint-disable-next-line no-await-in-loop
          await syncTeacherInClasses({
            teacherId: created._id,
            classNames: created.classes || [],
            subject: created.subject || created.subjects?.[0] || '',
          });
        }

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
    return res.status(500).json({ message: error.message || '???? ??????? ??????????.' });
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
        subjects: user.subject ? [user.subject] : user.subjects || [],
        profilePicture: user.profilePicture || user.avatarUrl || '',
      })),
      students: students.map((user) => ({
        email: user.email,
        name: user.name,
        password: '',
        classes: user.classes || [],
        profilePicture: user.profilePicture || user.avatarUrl || '',
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??????????.' });
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


