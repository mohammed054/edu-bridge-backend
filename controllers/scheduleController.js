const ClassModel = require('../models/Class');
const ScheduleEntry = require('../models/ScheduleEntry');
const User = require('../models/User');
const { sendServerError } = require('../utils/safeError');

const SCHOOL_DAY_RANGE = [1, 2, 3, 4, 5];

const DAY_NAME_TO_INDEX = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const DAY_INDEX_TO_NAME = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

const asTrimmed = (value) => String(value || '').trim();
const createHttpError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};
const respondWithScheduleError = (res, error, fallback) => {
  if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
    return res.status(Number(error.status)).json({ message: error.message });
  }
  return sendServerError(res, error, fallback);
};

const resolveDayOfWeek = (rawValue) => {
  const value = asTrimmed(rawValue);
  if (!value) {
    return null;
  }

  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= 7) {
    return asNumber;
  }

  return DAY_NAME_TO_INDEX[value.toLowerCase()] || null;
};

const sortBySlot = (left, right) => {
  if (left.dayOfWeek !== right.dayOfWeek) {
    return Number(left.dayOfWeek || 0) - Number(right.dayOfWeek || 0);
  }

  return String(left.startTime || '').localeCompare(String(right.startTime || ''));
};

const isValidTime = (value) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(asTrimmed(value));

const compareTime = (left, right) => asTrimmed(left).localeCompare(asTrimmed(right));

const validateTimeRange = (startTime, endTime) => isValidTime(startTime) && isValidTime(endTime) && compareTime(startTime, endTime) < 0;

const mapScheduleEntry = (entry, classMetaByName = {}) => {
  const classMeta = classMetaByName[entry.className] || {};
  return {
    id: String(entry._id),
    className: entry.className,
    grade: classMeta.grade || entry.grade || '',
    section: classMeta.section || '',
    dayOfWeek: Number(entry.dayOfWeek),
    dayName: DAY_INDEX_TO_NAME[Number(entry.dayOfWeek)] || '',
    startTime: entry.startTime,
    endTime: entry.endTime,
    subject: entry.subject,
    teacherId: String(entry.teacherId),
    teacherName: entry.teacherName || '',
    room: entry.room || '',
  };
};

const getClassMeta = async (classNames = []) => {
  const uniqueClassNames = [...new Set(classNames.filter(Boolean))];
  if (!uniqueClassNames.length) {
    return {};
  }

  const classes = await ClassModel.find(
    { name: { $in: uniqueClassNames } },
    { name: 1, grade: 1, section: 1 }
  ).lean();

  return classes.reduce((acc, item) => {
    acc[item.name] = {
      grade: item.grade || '',
      section: item.section || '',
    };
    return acc;
  }, {});
};

const getStudentWeeklySchedule = async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.user.id, role: 'student' }, { classes: 1 }).lean();
    const className = student?.classes?.[0] || '';

    if (!className) {
      return res.json({
        className: '',
        schoolDays: SCHOOL_DAY_RANGE,
        entries: [],
      });
    }

    const entries = await ScheduleEntry.find(
      {
        className,
        isActive: true,
        dayOfWeek: { $in: SCHOOL_DAY_RANGE },
      },
      {
        className: 1,
        grade: 1,
        dayOfWeek: 1,
        startTime: 1,
        endTime: 1,
        subject: 1,
        teacherId: 1,
        teacherName: 1,
        room: 1,
      }
    ).lean();

    const classMetaByName = await getClassMeta([className]);
    return res.json({
      className,
      schoolDays: SCHOOL_DAY_RANGE,
      entries: entries.map((item) => mapScheduleEntry(item, classMetaByName)).sort(sortBySlot),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load student schedule.');
  }
};

const getTeacherWeeklySchedule = async (req, res) => {
  try {
    const classNameFilter = asTrimmed(req.query?.className);
    if (classNameFilter && !req.user.classes?.includes(classNameFilter)) {
      return res.status(403).json({ message: 'You are not allowed to view this class schedule.' });
    }

    const dayFilter = resolveDayOfWeek(req.query?.day);

    const query = {
      teacherId: req.user.id,
      isActive: true,
      dayOfWeek: dayFilter || { $in: SCHOOL_DAY_RANGE },
    };

    if (classNameFilter) {
      query.className = classNameFilter;
    }

    const entries = await ScheduleEntry.find(query, {
      className: 1,
      grade: 1,
      dayOfWeek: 1,
      startTime: 1,
      endTime: 1,
      subject: 1,
      teacherId: 1,
      teacherName: 1,
      room: 1,
    }).lean();

    const classMetaByName = await getClassMeta(entries.map((item) => item.className));

    return res.json({
      schoolDays: SCHOOL_DAY_RANGE,
      entries: entries.map((item) => mapScheduleEntry(item, classMetaByName)).sort(sortBySlot),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load teacher schedule.');
  }
};

const getAdminScheduleOverview = async (req, res) => {
  try {
    const gradeFilter = asTrimmed(req.query?.grade);
    const classNameFilter = asTrimmed(req.query?.className);
    const teacherIdFilter = asTrimmed(req.query?.teacherId);
    const dayFilter = resolveDayOfWeek(req.query?.day);

    let classNamesFromGrade = null;
    if (gradeFilter) {
      const matchingClasses = await ClassModel.find({ grade: gradeFilter }, { name: 1 }).lean();
      classNamesFromGrade = matchingClasses.map((item) => item.name);
    }

    const query = {
      isActive: true,
      dayOfWeek: dayFilter || { $in: SCHOOL_DAY_RANGE },
    };

    if (teacherIdFilter) {
      query.teacherId = teacherIdFilter;
    }

    if (classNameFilter) {
      query.className = classNameFilter;
    } else if (classNamesFromGrade) {
      query.className = classNamesFromGrade.length ? { $in: classNamesFromGrade } : '__none__';
    }

    const entries = await ScheduleEntry.find(query, {
      className: 1,
      grade: 1,
      dayOfWeek: 1,
      startTime: 1,
      endTime: 1,
      subject: 1,
      teacherId: 1,
      teacherName: 1,
      room: 1,
    }).lean();

    const classMetaByName = await getClassMeta(entries.map((item) => item.className));

    return res.json({
      schoolDays: SCHOOL_DAY_RANGE,
      filters: {
        grade: gradeFilter || '',
        className: classNameFilter || '',
        teacherId: teacherIdFilter || '',
        day: dayFilter || null,
      },
      entries: entries.map((item) => mapScheduleEntry(item, classMetaByName)).sort(sortBySlot),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load schedule overview.');
  }
};

const resolveTeacherForSchedule = async ({ teacherId }) => {
  const cleanTeacherId = asTrimmed(teacherId);
  if (!cleanTeacherId) return null;
  const teacher = await User.findOne(
    { _id: cleanTeacherId, role: 'teacher', isActive: { $ne: false } },
    { _id: 1, name: 1, classes: 1, subject: 1, subjects: 1 }
  ).lean();
  return teacher || null;
};

const createScheduleEntryCore = async ({ actor, body, mode = 'admin' }) => {
  const className = asTrimmed(body?.className);
  const dayOfWeek = resolveDayOfWeek(body?.dayOfWeek || body?.day);
  const startTime = asTrimmed(body?.startTime);
  const endTime = asTrimmed(body?.endTime);
  const subject = asTrimmed(body?.subject);
  const room = asTrimmed(body?.room);

  if (!className || !dayOfWeek || !subject || !startTime || !endTime) {
    throw createHttpError('Class, day, subject, and time range are required.', 400);
  }
  if (!validateTimeRange(startTime, endTime)) {
    throw createHttpError('Time range is invalid.', 400);
  }

  const classDoc = await ClassModel.findOne({ name: className }, { name: 1, grade: 1 }).lean();
  if (!classDoc) {
    throw createHttpError('Class not found.', 404);
  }

  let teacherId = asTrimmed(body?.teacherId);
  let teacherName = asTrimmed(body?.teacherName);

  if (mode === 'teacher') {
    if (!actor.classes?.includes(className)) {
      throw createHttpError('Class access denied.', 403);
    }
    if (!(actor.subjects || []).some((item) => String(item || '').toLowerCase() === subject.toLowerCase())) {
      throw createHttpError('Subject access denied.', 403);
    }
    teacherId = actor.id;
    teacherName = actor.name || 'Teacher';
  } else {
    if (!teacherId) {
      throw createHttpError('Teacher identifier is required for admin schedule creation.', 400);
    }
    const teacher = await resolveTeacherForSchedule({ teacherId });
    if (!teacher) {
      throw createHttpError('Teacher not found.', 404);
    }
    if (!(teacher.classes || []).includes(className)) {
      throw createHttpError('Teacher is not assigned to this class.', 400);
    }
    const allowedSubjects = teacher.subject ? [teacher.subject] : teacher.subjects || [];
    if (!allowedSubjects.some((item) => String(item || '').toLowerCase() === subject.toLowerCase())) {
      throw createHttpError('Teacher does not own this subject.', 400);
    }
    teacherId = String(teacher._id);
    teacherName = teacher.name || '';
  }

  const created = await ScheduleEntry.create({
    className,
    grade: classDoc.grade || '',
    dayOfWeek,
    startTime,
    endTime,
    subject,
    teacherId,
    teacherName,
    room,
    isActive: true,
  });

  return created;
};

const createAdminScheduleEntry = async (req, res) => {
  try {
    const created = await createScheduleEntryCore({ actor: req.user, body: req.body, mode: 'admin' });
    const classMetaByName = await getClassMeta([created.className]);
    return res.status(201).json({ entry: mapScheduleEntry(created.toObject(), classMetaByName) });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to create schedule entry.');
  }
};

const createTeacherScheduleEntry = async (req, res) => {
  try {
    const created = await createScheduleEntryCore({ actor: req.user, body: req.body, mode: 'teacher' });
    const classMetaByName = await getClassMeta([created.className]);
    return res.status(201).json({ entry: mapScheduleEntry(created.toObject(), classMetaByName) });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to create schedule entry.');
  }
};

const updateScheduleEntryCore = async ({ actor, entryId, body, mode = 'admin' }) => {
  const entry = await ScheduleEntry.findById(entryId);
  if (!entry || entry.isActive === false) {
    throw createHttpError('Schedule entry not found.', 404);
  }

  if (mode === 'teacher' && String(entry.teacherId) !== String(actor.id)) {
    throw createHttpError('You are not allowed to modify this schedule entry.', 403);
  }

  const nextClassName = body?.className !== undefined ? asTrimmed(body.className) : entry.className;
  const nextDay = body?.dayOfWeek !== undefined || body?.day !== undefined
    ? resolveDayOfWeek(body?.dayOfWeek || body?.day)
    : Number(entry.dayOfWeek);
  const nextStartTime = body?.startTime !== undefined ? asTrimmed(body.startTime) : entry.startTime;
  const nextEndTime = body?.endTime !== undefined ? asTrimmed(body.endTime) : entry.endTime;
  const nextSubject = body?.subject !== undefined ? asTrimmed(body.subject) : entry.subject;
  const nextRoom = body?.room !== undefined ? asTrimmed(body.room) : entry.room;

  if (!nextClassName || !nextDay || !nextSubject || !nextStartTime || !nextEndTime) {
    throw createHttpError('Schedule entry payload is incomplete.', 400);
  }
  if (!validateTimeRange(nextStartTime, nextEndTime)) {
    throw createHttpError('Time range is invalid.', 400);
  }

  const classDoc = await ClassModel.findOne({ name: nextClassName }, { name: 1, grade: 1 }).lean();
  if (!classDoc) {
    throw createHttpError('Class not found.', 404);
  }

  if (mode === 'teacher') {
    if (!actor.classes?.includes(nextClassName)) {
      throw createHttpError('Class access denied.', 403);
    }
    if (!(actor.subjects || []).some((item) => String(item || '').toLowerCase() === nextSubject.toLowerCase())) {
      throw createHttpError('Subject access denied.', 403);
    }
    entry.teacherId = actor.id;
    entry.teacherName = actor.name || 'Teacher';
  } else if (body?.teacherId !== undefined) {
    const teacher = await resolveTeacherForSchedule({ teacherId: body.teacherId });
    if (!teacher) {
      throw createHttpError('Teacher not found.', 404);
    }
    if (!(teacher.classes || []).includes(nextClassName)) {
      throw createHttpError('Teacher is not assigned to this class.', 400);
    }
    const allowedSubjects = teacher.subject ? [teacher.subject] : teacher.subjects || [];
    if (!allowedSubjects.some((item) => String(item || '').toLowerCase() === nextSubject.toLowerCase())) {
      throw createHttpError('Teacher does not own this subject.', 400);
    }
    entry.teacherId = teacher._id;
    entry.teacherName = teacher.name || '';
  }

  entry.className = nextClassName;
  entry.grade = classDoc.grade || '';
  entry.dayOfWeek = nextDay;
  entry.startTime = nextStartTime;
  entry.endTime = nextEndTime;
  entry.subject = nextSubject;
  entry.room = nextRoom;
  await entry.save();
  return entry;
};

const updateAdminScheduleEntry = async (req, res) => {
  try {
    const entry = await updateScheduleEntryCore({
      actor: req.user,
      entryId: asTrimmed(req.params?.id),
      body: req.body,
      mode: 'admin',
    });
    const classMetaByName = await getClassMeta([entry.className]);
    return res.json({ entry: mapScheduleEntry(entry.toObject(), classMetaByName) });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to update schedule entry.');
  }
};

const updateTeacherScheduleEntry = async (req, res) => {
  try {
    const entry = await updateScheduleEntryCore({
      actor: req.user,
      entryId: asTrimmed(req.params?.id),
      body: req.body,
      mode: 'teacher',
    });
    const classMetaByName = await getClassMeta([entry.className]);
    return res.json({ entry: mapScheduleEntry(entry.toObject(), classMetaByName) });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to update schedule entry.');
  }
};

const deleteScheduleEntryCore = async ({ actor, entryId, mode = 'admin' }) => {
  const entry = await ScheduleEntry.findById(entryId);
  if (!entry || entry.isActive === false) {
    throw createHttpError('Schedule entry not found.', 404);
  }
  if (mode === 'teacher' && String(entry.teacherId) !== String(actor.id)) {
    throw createHttpError('You are not allowed to remove this schedule entry.', 403);
  }
  entry.isActive = false;
  await entry.save();
  return entry;
};

const deleteAdminScheduleEntry = async (req, res) => {
  try {
    const entry = await deleteScheduleEntryCore({
      actor: req.user,
      entryId: asTrimmed(req.params?.id),
      mode: 'admin',
    });
    return res.json({ success: true, deletedId: String(entry._id) });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to delete schedule entry.');
  }
};

const deleteTeacherScheduleEntry = async (req, res) => {
  try {
    const entry = await deleteScheduleEntryCore({
      actor: req.user,
      entryId: asTrimmed(req.params?.id),
      mode: 'teacher',
    });
    return res.json({ success: true, deletedId: String(entry._id) });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to delete schedule entry.');
  }
};

module.exports = {
  getAdminScheduleOverview,
  getStudentWeeklySchedule,
  getTeacherWeeklySchedule,
  createAdminScheduleEntry,
  updateAdminScheduleEntry,
  deleteAdminScheduleEntry,
  createTeacherScheduleEntry,
  updateTeacherScheduleEntry,
  deleteTeacherScheduleEntry,
};
