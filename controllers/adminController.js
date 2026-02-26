const bcrypt = require('bcrypt');
const ClassModel = require('../models/Class');
const User = require('../models/User');
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

const buildUserPayload = async ({ role, name, email, password, classes, subjects }) => {
  const cleanName = normalizeIdentifier(name);
  const cleanPassword = String(password || '');
  const cleanEmail = normalizeEmail(email);
  const cleanClasses = normalizeClasses(classes);
  const cleanSubjects = role === 'teacher' ? normalizeSubjects(subjects) : [];

  if (!cleanName) {
    return { error: 'Name is required.' };
  }

  const emailError = validateEmailByRole(role, cleanEmail);
  if (emailError) {
    return { error: emailError };
  }

  if (!cleanPassword) {
    return { error: 'Password is required.' };
  }

  await ensureClassesExist(cleanClasses);

  const passwordHash = await bcrypt.hash(cleanPassword, SALT_ROUNDS);
  return {
    payload: {
      role,
      name: cleanName,
      email: cleanEmail,
      classes: cleanClasses,
      subjects: cleanSubjects,
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

    const availableSubjects = [
      ...new Set(
        teachers
          .flatMap((item) => item.subjects || [])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b, 'ar'));

    return res.json({
      classes: classes.map((item) => ({
        id: String(item._id),
        name: item.name,
      })),
      teachers: teachers.map((item) => ({
        id: String(item._id),
        name: item.name,
        email: item.email,
        classes: item.classes || [],
        subjects: item.subjects || [],
      })),
      students: students.map((item) => ({
        id: String(item._id),
        name: item.name,
        email: item.email,
        classes: item.classes || [],
        absentDays: Number(item.absentDays || 0),
        negativeReports: Number(item.negativeReports || 0),
      })),
      availableSubjects,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load admin overview.' });
  }
};

const getReports = async (_req, res) => {
  try {
    const reports = await buildAdminReports();
    return res.json(reports);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to build admin reports.' });
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
      return res.status(409).json({ message: 'Teacher already exists.' });
    }

    const user = await User.create(payload);
    return res.status(201).json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to add teacher.' });
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
      return res.status(409).json({ message: 'Student already exists.' });
    }

    const user = await User.create(payload);
    return res.status(201).json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to add student.' });
  }
};

const removeTeacher = async (req, res) => {
  try {
    const deleted = await User.findOneAndDelete({
      _id: req.params.id,
      role: 'teacher',
    });

    if (!deleted) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    return res.json({ message: 'Teacher removed.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to remove teacher.' });
  }
};

const removeStudent = async (req, res) => {
  try {
    const deleted = await User.findOneAndDelete({
      _id: req.params.id,
      role: 'student',
    });

    if (!deleted) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    return res.json({ message: 'Student removed.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to remove student.' });
  }
};

const addClass = async (req, res) => {
  try {
    const className = normalizeIdentifier(req.body?.name);
    if (!className) {
      return res.status(400).json({ message: 'Class name is required.' });
    }

    const exists = await ClassModel.findOne({ name: className });
    if (exists) {
      return res.status(409).json({ message: 'Class already exists.' });
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
    return res.status(500).json({ message: error.message || 'Failed to add class.' });
  }
};

const removeClass = async (req, res) => {
  try {
    const classItem = await ClassModel.findByIdAndDelete(req.params.id);
    if (!classItem) {
      return res.status(404).json({ message: 'Class not found.' });
    }

    await User.updateMany({}, { $pull: { classes: classItem.name } });
    return res.json({ message: 'Class removed.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to remove class.' });
  }
};

const updateTeacherAssignment = async (req, res) => {
  try {
    const classes = normalizeClasses(req.body?.classes || []);
    const subjects = normalizeSubjects(req.body?.subjects || []);

    await ensureClassesExist(classes);

    const teacher = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'teacher' },
      {
        $set: {
          classes,
          subjects,
        },
      },
      { new: true }
    );

    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    return res.json({ user: teacher.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update teacher assignment.' });
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
    return res.status(500).json({ message: error.message || 'Failed to import users.' });
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
    return res.status(500).json({ message: error.message || 'Failed to export users.' });
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
};
