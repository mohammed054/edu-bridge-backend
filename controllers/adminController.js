
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const mongoose = require('mongoose');
const ClassModel = require('../models/Class');
const Subject = require('../models/Subject');
const User = require('../models/User');
const Report = require('../models/Report');
const { HIKMAH_SUBJECTS } = require('../constants/subjects');
const { buildAdminReports } = require('../services/reportService');
const { buildAdminAiAnalytics } = require('../services/adminAnalyticsService');
const {
  normalizeEmail,
  normalizeIdentifier,
  normalizeClasses,
  normalizeSubjects,
  validateEmailByRole,
} = require('../utils/userValidation');

const SALT_ROUNDS = 10;
const IMPORT_MAX_USERS = 10000;
const IMPORT_MAX_BYTES = 6 * 1024 * 1024;
const GENERATED_PASSWORD_LENGTH = 16;

const asTrimmed = (value) => String(value || '').trim();

const toBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = asTrimmed(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const createHttpError = (message, status = 400, details = null) => {
  const error = new Error(message);
  error.status = status;
  if (details) {
    error.details = details;
  }
  return error;
};

const parseJsonOrThrow = (rawText, message = 'Invalid JSON payload.') => {
  try {
    return JSON.parse(rawText);
  } catch {
    throw createHttpError(message, 400);
  }
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const readRawBody = (req, maxBytes = IMPORT_MAX_BYTES) =>
  new Promise((resolve, reject) => {
    if (req.readableEnded) {
      resolve(Buffer.alloc(0));
      return;
    }

    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(createHttpError('Import file exceeds size limit.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (error) => {
      reject(error);
    });
  });

const parseMultipartJsonPayload = (rawBuffer, contentTypeHeader) => {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader || '');
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];

  if (!boundary) {
    throw createHttpError('Multipart request is missing a valid boundary.', 400);
  }

  const boundaryToken = `--${boundary}`;
  const bodyText = rawBuffer.toString('utf8');
  const segments = bodyText.split(boundaryToken);

  for (const segment of segments) {
    const normalized = segment.trim();
    if (!normalized || normalized === '--') {
      continue;
    }

    const cleanSegment = normalized.endsWith('--')
      ? normalized.slice(0, -2).trim()
      : normalized;

    const separatorIndex = cleanSegment.indexOf('\r\n\r\n');
    if (separatorIndex < 0) {
      continue;
    }

    const headerBlock = cleanSegment.slice(0, separatorIndex);
    const payloadBlock = cleanSegment.slice(separatorIndex + 4).replace(/\r\n$/, '');

    const lowerHeaders = headerBlock.toLowerCase();
    const hasJsonMime =
      lowerHeaders.includes('content-type: application/json') ||
      lowerHeaders.includes('content-type: text/plain');
    const hasJsonFilename = /filename="[^"]+\.json"/i.test(headerBlock);
    const hasKnownField = /name="(file|json|payload|import)"/i.test(headerBlock);

    if ((hasJsonMime || hasJsonFilename || hasKnownField) && payloadBlock.trim()) {
      return parseJsonOrThrow(payloadBlock.trim(), 'Uploaded file is not valid JSON.');
    }
  }

  throw createHttpError('No JSON file part was found in multipart payload.', 400);
};

const extractImportPayload = async (req) => {
  if (req.body && typeof req.body === 'object') {
    if (Array.isArray(req.body.students) || Array.isArray(req.body.teachers)) {
      return req.body;
    }

    if (typeof req.body.payload === 'string' && req.body.payload.trim()) {
      return parseJsonOrThrow(req.body.payload, 'Invalid JSON inside payload field.');
    }
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();

  if (contentType.includes('multipart/form-data')) {
    const raw = await readRawBody(req);
    return parseMultipartJsonPayload(raw, contentType);
  }

  if (contentType.includes('text/plain') || contentType.includes('application/octet-stream')) {
    const raw = await readRawBody(req);
    const text = raw.toString('utf8').trim();
    if (!text) {
      throw createHttpError('Import payload is empty.', 400);
    }
    return parseJsonOrThrow(text, 'Invalid JSON in uploaded content.');
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    return parseJsonOrThrow(req.body, 'Invalid JSON payload.');
  }

  throw createHttpError('Import payload must include students and/or teachers arrays.', 400);
};

const buildRandomPassword = (length = GENERATED_PASSWORD_LENGTH) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = crypto.randomBytes(length);
  let output = '';

  for (let index = 0; index < length; index += 1) {
    output += alphabet[bytes[index] % alphabet.length];
  }

  return output;
};

const ensureClassesExist = async (classNames, { session, autoCreate = true } = {}) => {
  const uniqueClassNames = normalizeClasses(classNames);
  if (!uniqueClassNames.length) {
    return { existing: [], missing: [] };
  }

  const query = ClassModel.find({ name: { $in: uniqueClassNames } }, { name: 1 }).lean();
  const existingDocs = session ? await query.session(session) : await query;

  const existingSet = new Set(existingDocs.map((item) => item.name));
  const missing = uniqueClassNames.filter((name) => !existingSet.has(name));

  if (missing.length && autoCreate) {
    await Promise.all(
      missing.map((name) =>
        ClassModel.updateOne(
          { name },
          { $setOnInsert: { name, grade: '', section: '', teachers: [], subjects: [] } },
          { upsert: true, ...(session ? { session } : {}) }
        )
      )
    );
  }

  return {
    existing: uniqueClassNames.filter((name) => existingSet.has(name)),
    missing,
  };
};

const ensureSubjectExists = async (subjectName, { session } = {}) => {
  const normalizedSubject = asTrimmed(subjectName);
  if (!normalizedSubject) {
    return;
  }

  await Subject.updateOne(
    { name: normalizedSubject },
    { $setOnInsert: { name: normalizedSubject, maxMarks: 100 } },
    { upsert: true, ...(session ? { session } : {}) }
  );
};

const syncTeacherInClasses = async ({ teacherId, classNames, subject, session } = {}) => {
  const normalizedClasses = normalizeClasses(classNames);
  const options = session ? { session } : {};

  await ClassModel.updateMany(
    { teachers: teacherId, name: { $nin: normalizedClasses } },
    { $pull: { teachers: teacherId } },
    options
  );

  if (!normalizedClasses.length) {
    return;
  }

  await ClassModel.updateMany(
    { name: { $in: normalizedClasses } },
    {
      $addToSet: {
        teachers: teacherId,
        ...(subject ? { subjects: subject } : {}),
      },
    },
    options
  );
};
const resolveTeacherSubject = (subjectsInput) => {
  const cleanSubjects = normalizeSubjects(subjectsInput);

  if (cleanSubjects.length !== 1) {
    return { error: 'Teacher must be assigned exactly one subject.' };
  }

  if (!HIKMAH_SUBJECTS.includes(cleanSubjects[0])) {
    return { error: `Subject must be one of the official school subjects: ${HIKMAH_SUBJECTS.join(', ')}` };
  }

  return { subject: cleanSubjects[0] };
};

const resolveStudentClass = (classesInput) => {
  const cleanClasses = normalizeClasses(classesInput);

  if (cleanClasses.length !== 1) {
    return { error: 'Student must belong to exactly one class.' };
  }

  return { className: cleanClasses[0] };
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
  isActive: item.isActive !== false,
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
  isActive: item.isActive !== false,
});

const buildUserPayload = async ({
  role,
  name,
  email,
  password,
  classes,
  subjects,
  profilePicture,
}) => {
  const cleanName = normalizeIdentifier(name);
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || '');
  const cleanClasses = normalizeClasses(classes);
  const cleanProfilePicture = asTrimmed(profilePicture);

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

  let subject = '';
  let nextClasses = cleanClasses;

  if (role === 'student') {
    const classResolve = resolveStudentClass(cleanClasses);
    if (classResolve.error) {
      return { error: classResolve.error };
    }

    nextClasses = [classResolve.className];
  }

  if (role === 'teacher') {
    const subjectResolve = resolveTeacherSubject(subjects);
    if (subjectResolve.error) {
      return { error: subjectResolve.error };
    }

    subject = subjectResolve.subject;
    if (!nextClasses.length) {
      return { error: 'Teacher must be assigned to at least one class.' };
    }
  }

  await ensureClassesExist(nextClasses, { autoCreate: true });
  if (subject) {
    await ensureSubjectExists(subject);
  }

  const passwordHash = await bcrypt.hash(cleanPassword, SALT_ROUNDS);

  return {
    payload: {
      role,
      name: cleanName,
      email: cleanEmail,
      passwordHash,
      classes: nextClasses,
      subject,
      subjects: subject ? [subject] : [],
      profilePicture: cleanProfilePicture,
      avatarUrl: cleanProfilePicture,
      isActive: true,
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

    const availableSubjects = [...HIKMAH_SUBJECTS];

    return res.json({
      classes: classes.map(mapClassPayload),
      teachers: teachers.map(mapTeacherPayload),
      students: students.map(mapStudentPayload),
      availableSubjects,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch admin overview.' });
  }
};

const getReports = async (req, res) => {
  try {
    const reports = await buildAdminReports();

    await Report.create({
      generatedBy: req.user.id,
      type: 'admin_aggregate',
      payload: reports,
    });

    return res.json(reports);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to build reports.' });
  }
};

const getAiAnalytics = async (_req, res) => {
  try {
    const insights = await buildAdminAiAnalytics();
    return res.json(insights);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to compute analytics insights.' });
  }
};

const addTeacher = async (req, res) => {
  try {
    const { payload, error } = await buildUserPayload({
      role: 'teacher',
      name: req.body?.fullName || req.body?.name,
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
      return res.status(409).json({ message: 'Email already exists.' });
    }

    const user = await User.create(payload);

    await syncTeacherInClasses({
      teacherId: user._id,
      classNames: user.classes,
      subject: user.subject || user.subjects?.[0] || '',
    });

    return res.status(201).json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to add teacher.' });
  }
};

const addStudent = async (req, res) => {
  try {
    const { payload, error } = await buildUserPayload({
      role: 'student',
      name: req.body?.fullName || req.body?.name,
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
      return res.status(409).json({ message: 'Email already exists.' });
    }

    const user = await User.create(payload);
    return res.status(201).json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to add student.' });
  }
};

const addClass = async (req, res) => {
  try {
    const className = normalizeIdentifier(req.body?.name);
    const grade = normalizeIdentifier(req.body?.grade);
    const section = normalizeIdentifier(req.body?.section);

    if (!className) {
      return res.status(400).json({ message: 'Class name is required.' });
    }

    const exists = await ClassModel.findOne({ name: className });
    if (exists) {
      return res.status(409).json({ message: 'Class already exists.' });
    }

    const created = await ClassModel.create({
      name: className,
      grade,
      section,
      teachers: [],
      subjects: [],
    });

    return res.status(201).json({ classItem: mapClassPayload(created) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to add class.' });
  }
};

const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user || !['teacher', 'student'].includes(user.role)) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (user.role === 'teacher') {
      await ClassModel.updateMany({ teachers: user._id }, { $pull: { teachers: user._id } });
    }

    await User.deleteOne({ _id: user._id });

    return res.json({
      success: true,
      deletedUserId: String(user._id),
      role: user.role,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to delete user.' });
  }
};

const removeTeacher = async (req, res) => deleteUser(req, res);

const removeStudent = async (req, res) => deleteUser(req, res);

const removeClass = async (req, res) => {
  try {
    const classItem = await ClassModel.findById(req.params.id);
    if (!classItem) {
      return res.status(404).json({ message: 'Class not found.' });
    }

    const studentsInClass = await User.countDocuments({
      role: 'student',
      classes: classItem.name,
    });

    if (studentsInClass > 0) {
      return res.status(400).json({
        message: 'Cannot remove class while students are still assigned to it.',
      });
    }

    await ClassModel.deleteOne({ _id: classItem._id });
    await User.updateMany({ role: 'teacher' }, { $pull: { classes: classItem.name } });

    return res.json({ success: true, deletedClassId: String(classItem._id) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to remove class.' });
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

    if (!classes.length) {
      return res.status(400).json({ message: 'Teacher must be assigned to at least one class.' });
    }

    await ensureClassesExist(classes, { autoCreate: true });
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
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    await syncTeacherInClasses({
      teacherId: teacher._id,
      classNames: classes,
      subject: subjectResolve.subject,
    });

    return res.json({ user: teacher.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update teacher assignment.' });
  }
};

const updateStudentAssignment = async (req, res) => {
  try {
    const classes = req.body?.className ? [req.body.className] : req.body?.classes || [];
    const classResolve = resolveStudentClass(classes);

    if (classResolve.error) {
      return res.status(400).json({ message: classResolve.error });
    }

    await ensureClassesExist([classResolve.className], { autoCreate: true });

    const student = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'student' },
      { $set: { classes: [classResolve.className] } },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    return res.json({ user: student.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update student assignment.' });
  }
};

const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const requestedRole = asTrimmed(req.body?.role).toLowerCase();
    if (requestedRole && requestedRole !== user.role) {
      return res.status(400).json({ message: 'Changing user role is not allowed.' });
    }

    const updates = {};

    if (req.body?.fullName !== undefined || req.body?.name !== undefined) {
      const cleanName = normalizeIdentifier(req.body?.fullName || req.body?.name);
      if (!cleanName) {
        return res.status(400).json({ message: 'Name is required.' });
      }
      updates.name = cleanName;
    }

    if (req.body?.email !== undefined) {
      const cleanEmail = normalizeEmail(req.body?.email);
      const emailError = validateEmailByRole(user.role, cleanEmail);
      if (emailError) {
        return res.status(400).json({ message: emailError });
      }

      const duplicate = await User.findOne({ _id: { $ne: user._id }, email: cleanEmail });
      if (duplicate) {
        return res.status(409).json({ message: 'Email already exists.' });
      }

      updates.email = cleanEmail;
    }

    if (req.body?.profilePicture !== undefined || req.body?.avatarUrl !== undefined) {
      const avatar = asTrimmed(req.body?.profilePicture || req.body?.avatarUrl);
      updates.profilePicture = avatar;
      updates.avatarUrl = avatar;
    }

    if (user.role === 'student' && (req.body?.className !== undefined || req.body?.classes !== undefined)) {
      const candidateClasses = req.body?.className
        ? [req.body.className]
        : ensureArray(req.body?.classes);
      const classResolve = resolveStudentClass(candidateClasses);

      if (classResolve.error) {
        return res.status(400).json({ message: classResolve.error });
      }

      const autoCreateClasses = toBoolean(req.body?.autoCreateClasses);
      const classCheck = await ensureClassesExist([classResolve.className], {
        autoCreate: autoCreateClasses,
      });

      if (classCheck.missing.length) {
        return res.status(400).json({
          message: `Class does not exist: ${classCheck.missing.join(', ')}`,
        });
      }

      updates.classes = [classResolve.className];
    }

    if (user.role === 'teacher') {
      if (req.body?.subject !== undefined || req.body?.subjects !== undefined) {
        const rawSubjects = req.body?.subject
          ? [req.body.subject]
          : ensureArray(req.body?.subjects);
        const subjectResolve = resolveTeacherSubject(rawSubjects);

        if (subjectResolve.error) {
          return res.status(400).json({ message: subjectResolve.error });
        }

        await ensureSubjectExists(subjectResolve.subject);
        updates.subject = subjectResolve.subject;
        updates.subjects = [subjectResolve.subject];
      }

      if (req.body?.classes !== undefined) {
        const classes = normalizeClasses(req.body?.classes);
        if (!classes.length) {
          return res.status(400).json({ message: 'Teacher must be assigned to at least one class.' });
        }

        const autoCreateClasses = toBoolean(req.body?.autoCreateClasses);
        const classCheck = await ensureClassesExist(classes, {
          autoCreate: autoCreateClasses,
        });

        if (classCheck.missing.length) {
          return res.status(400).json({
            message: `Class does not exist: ${classCheck.missing.join(', ')}`,
          });
        }

        updates.classes = classes;
      }
    }

    Object.assign(user, updates);
    await user.save();

    if (user.role === 'teacher') {
      await syncTeacherInClasses({
        teacherId: user._id,
        classNames: user.classes,
        subject: user.subject || user.subjects?.[0] || '',
      });
    }

    return res.json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update user.' });
  }
};

const setUserStatus = async (req, res) => {
  try {
    if (typeof req.body?.active !== 'boolean') {
      return res.status(400).json({ message: 'The active flag must be a boolean.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (user.role === 'admin' && req.body.active === false) {
      return res.status(400).json({ message: 'Admin accounts cannot be deactivated.' });
    }

    user.isActive = req.body.active;
    await user.save();

    return res.json({ user: user.toSafeObject() });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update user status.' });
  }
};

const resetUserPassword = async (req, res) => {
  try {
    const newPassword = String(req.body?.newPassword || '');
    if (!newPassword) {
      return res.status(400).json({ message: 'New password is required.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await user.save();

    return res.json({ success: true, userId: String(user._id) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to reset password.' });
  }
};

const normalizeImportStudents = (inputRows) =>
  ensureArray(inputRows).map((entry, index) => {
    const classes = normalizeClasses(entry?.classes);
    const classNameFromArray = classes.length === 1 ? classes[0] : '';
    const className = asTrimmed(entry?.className || classNameFromArray);

    return {
      role: 'student',
      index,
      fullName: normalizeIdentifier(entry?.fullName || entry?.name),
      email: normalizeEmail(entry?.email),
      className,
      classes,
      password: String(entry?.password || ''),
    };
  });

const normalizeImportTeachers = (inputRows) =>
  ensureArray(inputRows).map((entry, index) => {
    const normalizedClasses = normalizeClasses(entry?.classes || [entry?.className].filter(Boolean));
    const subjectFromArray = normalizeSubjects(entry?.subjects || []);
    const subject = asTrimmed(entry?.subject || subjectFromArray[0] || '');

    return {
      role: 'teacher',
      index,
      fullName: normalizeIdentifier(entry?.fullName || entry?.name),
      email: normalizeEmail(entry?.email),
      subject,
      classes: normalizedClasses,
      password: String(entry?.password || ''),
    };
  });

const pushImportError = (errors, { role, index, email, code, message }) => {
  errors.push({
    role,
    index: Number(index) + 1,
    email: email || '',
    code,
    message,
  });
};

const finalizeImportResponse = ({
  importedStudents,
  importedTeachers,
  skipped,
  skippedDuplicates,
  errors,
  dryRun,
  generatedPasswordCount,
}) => ({
  success: true,
  importedStudents,
  importedTeachers,
  skipped,
  skippedDuplicates,
  generatedPasswordCount,
  dryRun,
  errors,
  summary: {
    addedCount: importedStudents + importedTeachers,
    skippedDuplicates,
    errors,
  },
});
const importUsers = async (req, res) => {
  try {
    const payload = await extractImportPayload(req);

    const studentsInput = normalizeImportStudents(payload?.students);
    const teachersInput = normalizeImportTeachers(payload?.teachers);

    if (!studentsInput.length && !teachersInput.length) {
      return res.status(400).json({
        message: 'Import payload must include at least one student or teacher.',
      });
    }

    if (studentsInput.length + teachersInput.length > IMPORT_MAX_USERS) {
      return res.status(400).json({
        message: `Import payload exceeds the maximum of ${IMPORT_MAX_USERS} users.`,
      });
    }

    const autoCreateClasses = toBoolean(
      req.query?.autoCreateClasses ?? payload?.autoCreateClasses ?? payload?.options?.autoCreateClasses
    );
    const dryRun = toBoolean(req.query?.dryRun ?? payload?.dryRun);

    const allEmails = [...studentsInput, ...teachersInput].map((item) => item.email).filter(Boolean);
    const classNames = [
      ...studentsInput.map((item) => item.className),
      ...teachersInput.flatMap((item) => item.classes),
    ].filter(Boolean);
    const subjects = teachersInput.map((item) => item.subject).filter(Boolean);

    const [existingUsers, existingClassesDocs, existingSubjectsDocs] = await Promise.all([
      allEmails.length ? User.find({ email: { $in: allEmails } }, { email: 1 }).lean() : [],
      classNames.length ? ClassModel.find({ name: { $in: classNames } }, { name: 1 }).lean() : [],
      subjects.length ? Subject.find({ name: { $in: subjects } }, { name: 1 }).lean() : [],
    ]);

    const existingEmails = new Set(existingUsers.map((item) => item.email));
    const existingClasses = new Set(existingClassesDocs.map((item) => item.name));
    const existingSubjects = new Set(existingSubjectsDocs.map((item) => item.name));

    const errors = [];
    const validStudents = [];
    const validTeachers = [];
    const classesToCreate = new Set();
    const seenEmails = new Set();

    let skipped = 0;
    let skippedDuplicates = 0;

    for (const student of studentsInput) {
      if (!student.fullName) {
        skipped += 1;
        pushImportError(errors, {
          role: student.role,
          index: student.index,
          email: student.email,
          code: 'missing_name',
          message: 'Student fullName is required.',
        });
        continue;
      }

      const emailError = validateEmailByRole('student', student.email);
      if (emailError) {
        skipped += 1;
        pushImportError(errors, {
          role: student.role,
          index: student.index,
          email: student.email,
          code: 'invalid_email',
          message: emailError,
        });
        continue;
      }

      if (seenEmails.has(student.email) || existingEmails.has(student.email)) {
        skipped += 1;
        skippedDuplicates += 1;
        pushImportError(errors, {
          role: student.role,
          index: student.index,
          email: student.email,
          code: 'duplicate_email',
          message: 'Duplicate email detected.',
        });
        continue;
      }

      seenEmails.add(student.email);

      const classResolve = resolveStudentClass([student.className]);
      if (classResolve.error) {
        skipped += 1;
        pushImportError(errors, {
          role: student.role,
          index: student.index,
          email: student.email,
          code: 'invalid_class',
          message: classResolve.error,
        });
        continue;
      }

      if (!existingClasses.has(student.className)) {
        if (!autoCreateClasses) {
          skipped += 1;
          pushImportError(errors, {
            role: student.role,
            index: student.index,
            email: student.email,
            code: 'class_not_found',
            message: `Class does not exist: ${student.className}`,
          });
          continue;
        }

        classesToCreate.add(student.className);
      }

      validStudents.push(student);
    }

    for (const teacher of teachersInput) {
      if (!teacher.fullName) {
        skipped += 1;
        pushImportError(errors, {
          role: teacher.role,
          index: teacher.index,
          email: teacher.email,
          code: 'missing_name',
          message: 'Teacher fullName is required.',
        });
        continue;
      }

      const emailError = validateEmailByRole('teacher', teacher.email);
      if (emailError) {
        skipped += 1;
        pushImportError(errors, {
          role: teacher.role,
          index: teacher.index,
          email: teacher.email,
          code: 'invalid_email',
          message: emailError,
        });
        continue;
      }

      if (seenEmails.has(teacher.email) || existingEmails.has(teacher.email)) {
        skipped += 1;
        skippedDuplicates += 1;
        pushImportError(errors, {
          role: teacher.role,
          index: teacher.index,
          email: teacher.email,
          code: 'duplicate_email',
          message: 'Duplicate email detected.',
        });
        continue;
      }

      seenEmails.add(teacher.email);

      const subjectResolve = resolveTeacherSubject([teacher.subject]);
      if (subjectResolve.error) {
        skipped += 1;
        pushImportError(errors, {
          role: teacher.role,
          index: teacher.index,
          email: teacher.email,
          code: 'invalid_subject',
          message: subjectResolve.error,
        });
        continue;
      }

      if (!existingSubjects.has(subjectResolve.subject)) {
        skipped += 1;
        pushImportError(errors, {
          role: teacher.role,
          index: teacher.index,
          email: teacher.email,
          code: 'subject_not_found',
          message: `Subject does not exist in database: ${subjectResolve.subject}`,
        });
        continue;
      }

      if (!teacher.classes.length) {
        skipped += 1;
        pushImportError(errors, {
          role: teacher.role,
          index: teacher.index,
          email: teacher.email,
          code: 'missing_class',
          message: 'Teacher must be assigned to at least one class.',
        });
        continue;
      }

      const missingClasses = teacher.classes.filter((className) => !existingClasses.has(className));
      if (missingClasses.length && !autoCreateClasses) {
        skipped += 1;
        pushImportError(errors, {
          role: teacher.role,
          index: teacher.index,
          email: teacher.email,
          code: 'class_not_found',
          message: `Class does not exist: ${missingClasses.join(', ')}`,
        });
        continue;
      }

      missingClasses.forEach((className) => classesToCreate.add(className));
      validTeachers.push(teacher);
    }

    if (dryRun) {
      return res.json(
        finalizeImportResponse({
          importedStudents: validStudents.length,
          importedTeachers: validTeachers.length,
          skipped,
          skippedDuplicates,
          errors,
          dryRun: true,
          generatedPasswordCount: [...validStudents, ...validTeachers].filter((item) => !item.password).length,
        })
      );
    }

    if (!validStudents.length && !validTeachers.length) {
      return res.json(
        finalizeImportResponse({
          importedStudents: 0,
          importedTeachers: 0,
          skipped,
          skippedDuplicates,
          errors,
          dryRun: false,
          generatedPasswordCount: 0,
        })
      );
    }

    const session = await mongoose.startSession();
    let importedStudents = 0;
    let importedTeachers = 0;
    let generatedPasswordCount = 0;

    try {
      await session.withTransaction(async () => {
        if (autoCreateClasses && classesToCreate.size) {
          await ensureClassesExist([...classesToCreate], { session, autoCreate: true });
        }

        for (const teacher of validTeachers) {
          // eslint-disable-next-line no-await-in-loop
          const exists = await User.findOne({ email: teacher.email }).session(session);
          if (exists) {
            skipped += 1;
            skippedDuplicates += 1;
            pushImportError(errors, {
              role: teacher.role,
              index: teacher.index,
              email: teacher.email,
              code: 'duplicate_email',
              message: 'Duplicate email detected during transaction.',
            });
            continue;
          }

          const plainPassword = teacher.password || buildRandomPassword();
          if (!teacher.password) {
            generatedPasswordCount += 1;
          }

          // eslint-disable-next-line no-await-in-loop
          const passwordHash = await bcrypt.hash(plainPassword, SALT_ROUNDS);

          // eslint-disable-next-line no-await-in-loop
          const createdTeachers = await User.create(
            [
              {
                role: 'teacher',
                name: teacher.fullName,
                email: teacher.email,
                classes: teacher.classes,
                subject: teacher.subject,
                subjects: [teacher.subject],
                passwordHash,
                isActive: true,
              },
            ],
            { session }
          );

          const [created] = createdTeachers;

          // eslint-disable-next-line no-await-in-loop
          await syncTeacherInClasses({
            teacherId: created._id,
            classNames: teacher.classes,
            subject: teacher.subject,
            session,
          });

          importedTeachers += 1;
        }

        for (const student of validStudents) {
          // eslint-disable-next-line no-await-in-loop
          const exists = await User.findOne({ email: student.email }).session(session);
          if (exists) {
            skipped += 1;
            skippedDuplicates += 1;
            pushImportError(errors, {
              role: student.role,
              index: student.index,
              email: student.email,
              code: 'duplicate_email',
              message: 'Duplicate email detected during transaction.',
            });
            continue;
          }

          const plainPassword = student.password || buildRandomPassword();
          if (!student.password) {
            generatedPasswordCount += 1;
          }

          // eslint-disable-next-line no-await-in-loop
          const passwordHash = await bcrypt.hash(plainPassword, SALT_ROUNDS);

          // eslint-disable-next-line no-await-in-loop
          await User.create(
            [
              {
                role: 'student',
                name: student.fullName,
                email: student.email,
                classes: [student.className],
                passwordHash,
                isActive: true,
              },
            ],
            { session }
          );

          importedStudents += 1;
        }
      });
    } catch (transactionError) {
      if (transactionError?.message?.includes('Transaction numbers are only allowed')) {
        return res.status(500).json({
          message:
            'Database does not support multi-document transactions. Configure MongoDB as a replica set for atomic imports.',
        });
      }

      return res.status(500).json({
        message: 'Catastrophic error detected. Import transaction was rolled back.',
        debug: process.env.NODE_ENV === 'production' ? undefined : transactionError.message,
      });
    } finally {
      await session.endSession();
    }

    return res.json(
      finalizeImportResponse({
        importedStudents,
        importedTeachers,
        skipped,
        skippedDuplicates,
        errors,
        dryRun: false,
        generatedPasswordCount,
      })
    );
  } catch (error) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: error.message || 'Failed to import users.',
      ...(error.details ? { details: error.details } : {}),
    });
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
        fullName: user.name,
        name: user.name,
        email: user.email,
        subject: user.subject || user.subjects?.[0] || '',
        classes: user.classes || [],
        password: '',
        isActive: user.isActive !== false,
      })),
      students: students.map((user) => ({
        fullName: user.name,
        name: user.name,
        email: user.email,
        className: user.classes?.[0] || '',
        classes: user.classes || [],
        password: '',
        isActive: user.isActive !== false,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to export users.' });
  }
};

module.exports = {
  listOverview,
  getReports,
  getAiAnalytics,
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
  updateUser,
  setUserStatus,
  resetUserPassword,
  deleteUser,
};
