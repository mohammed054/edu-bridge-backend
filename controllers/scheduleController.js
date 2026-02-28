const ClassModel = require('../models/Class');
const ScheduleEntry = require('../models/ScheduleEntry');
const User = require('../models/User');
const { extractScheduleRows } = require('../services/scheduleImportService');
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

const toMinutes = (timeValue) => {
  const value = asTrimmed(timeValue);
  if (!isValidTime(value)) {
    return -1;
  }
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  return hours * 60 + minutes;
};

const overlaps = (aStart, aEnd, bStart, bEnd) => {
  const leftStart = toMinutes(aStart);
  const leftEnd = toMinutes(aEnd);
  const rightStart = toMinutes(bStart);
  const rightEnd = toMinutes(bEnd);
  if (leftStart < 0 || leftEnd < 0 || rightStart < 0 || rightEnd < 0) {
    return false;
  }
  return leftStart < rightEnd && rightStart < leftEnd;
};

const mapConflictFlags = ({ teacherOverlap = false, classOverlap = false, roomOverlap = false } = {}) => {
  const flags = [];
  if (teacherOverlap) flags.push('teacher_overlap');
  if (classOverlap) flags.push('class_overlap');
  if (roomOverlap) flags.push('room_overlap');
  return flags;
};

const findEntryConflicts = async ({
  entryId = null,
  className,
  dayOfWeek,
  startTime,
  endTime,
  teacherId,
  room,
}) => {
  const query = {
    isActive: true,
    dayOfWeek,
    _id: entryId ? { $ne: entryId } : { $exists: true },
    $or: [{ className }, { teacherId }, ...(room ? [{ room }] : [])],
  };

  const sameDayEntries = await ScheduleEntry.find(query, {
    className: 1,
    teacherId: 1,
    room: 1,
    startTime: 1,
    endTime: 1,
  }).lean();

  const conflicts = {
    teacherOverlap: false,
    classOverlap: false,
    roomOverlap: false,
  };

  sameDayEntries.forEach((item) => {
    if (!overlaps(startTime, endTime, item.startTime, item.endTime)) {
      return;
    }
    if (String(item.teacherId) === String(teacherId)) {
      conflicts.teacherOverlap = true;
    }
    if (item.className === className) {
      conflicts.classOverlap = true;
    }
    if (room && item.room && item.room === room) {
      conflicts.roomOverlap = true;
    }
  });

  return conflicts;
};

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
    sourceType: entry.sourceType || 'manual',
    status: entry.status || 'approved',
    conflictFlags: Array.isArray(entry.conflictFlags) ? entry.conflictFlags : [],
    patternKey: entry.patternKey || '',
    copiedFromEntryId: entry.copiedFromEntryId ? String(entry.copiedFromEntryId) : '',
    substitutionTeacherId: entry.substitutionTeacherId ? String(entry.substitutionTeacherId) : '',
    substitutionTeacherName: entry.substitutionTeacherName || '',
    rescheduledFrom: entry.rescheduledFrom || null,
    changeLog: Array.isArray(entry.changeLog)
      ? entry.changeLog.map((item) => ({
          action: item.action || '',
          actorId: item.actorId ? String(item.actorId) : '',
          actorRole: item.actorRole || '',
          summary: item.summary || '',
          at: item.at || null,
        }))
      : [],
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

const annotateConflictsForEntries = async (entries = []) => {
  if (!entries.length) {
    return [];
  }

  const byDay = entries.reduce((acc, item) => {
    const key = Number(item.dayOfWeek || 0);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {});

  const next = entries.map((item) => ({
    ...item,
    conflictFlags: Array.isArray(item.conflictFlags) ? [...item.conflictFlags] : [],
  }));

  Object.values(byDay).forEach((dayEntries) => {
    for (let index = 0; index < dayEntries.length; index += 1) {
      const left = dayEntries[index];
      const leftMatch = next.find((entry) => String(entry._id) === String(left._id));
      if (!leftMatch) continue;

      const flags = new Set(leftMatch.conflictFlags || []);
      for (let j = 0; j < dayEntries.length; j += 1) {
        if (index === j) continue;
        const right = dayEntries[j];
        if (!overlaps(left.startTime, left.endTime, right.startTime, right.endTime)) continue;
        if (String(left.teacherId) === String(right.teacherId)) flags.add('teacher_overlap');
        if (left.className === right.className) flags.add('class_overlap');
        if (left.room && right.room && left.room === right.room) flags.add('room_overlap');
      }
      leftMatch.conflictFlags = [...flags];
    }
  });

  return next;
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
    const withConflicts = await annotateConflictsForEntries(entries);
    return res.json({
      className,
      schoolDays: SCHOOL_DAY_RANGE,
      entries: withConflicts.map((item) => mapScheduleEntry(item, classMetaByName)).sort(sortBySlot),
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
    const withConflicts = await annotateConflictsForEntries(entries);

    return res.json({
      schoolDays: SCHOOL_DAY_RANGE,
      entries: withConflicts.map((item) => mapScheduleEntry(item, classMetaByName)).sort(sortBySlot),
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
    const withConflicts = await annotateConflictsForEntries(entries);

    return res.json({
      schoolDays: SCHOOL_DAY_RANGE,
      filters: {
        grade: gradeFilter || '',
        className: classNameFilter || '',
        teacherId: teacherIdFilter || '',
        day: dayFilter || null,
      },
      entries: withConflicts.map((item) => mapScheduleEntry(item, classMetaByName)).sort(sortBySlot),
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
  const sourceType = asTrimmed(body?.sourceType).toLowerCase() || 'manual';
  const patternKey = asTrimmed(body?.patternKey);
  const status = asTrimmed(body?.status).toLowerCase() || 'approved';
  const copiedFromEntryId = asTrimmed(body?.copiedFromEntryId) || null;
  const allowConflicts = body?.allowConflicts === true;

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

  const conflicts = await findEntryConflicts({
    className,
    dayOfWeek,
    startTime,
    endTime,
    teacherId,
    room,
  });
  const conflictFlags = mapConflictFlags(conflicts);
  if (conflictFlags.length && !allowConflicts) {
    throw createHttpError(`Schedule conflict detected: ${conflictFlags.join(', ')}`, 409);
  }

  const created = await ScheduleEntry.create({
    institutionId: actor.institutionId || 'hikmah-main',
    campusId: asTrimmed(body?.campusId) || actor.campusId || 'main-campus',
    academicYear: asTrimmed(body?.academicYear || actor.activeAcademicYear),
    className,
    grade: classDoc.grade || '',
    dayOfWeek,
    startTime,
    endTime,
    subject,
    teacherId,
    teacherName,
    room,
    sourceType: ['manual', 'ocr', 'ai_suggested', 'pattern_copy'].includes(sourceType)
      ? sourceType
      : 'manual',
    status: ['draft', 'approved', 'rejected'].includes(status) ? status : 'approved',
    patternKey,
    copiedFromEntryId: copiedFromEntryId || null,
    conflictFlags,
    changeLog: [
      {
        action: 'create',
        actorId: actor.id,
        actorRole: actor.role,
        summary: 'Schedule entry created.',
        at: new Date(),
      },
    ],
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
  const nextStatus = body?.status !== undefined ? asTrimmed(body.status).toLowerCase() : entry.status;
  const allowConflicts = body?.allowConflicts === true;

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

  const conflicts = await findEntryConflicts({
    entryId: entry._id,
    className: nextClassName,
    dayOfWeek: nextDay,
    startTime: nextStartTime,
    endTime: nextEndTime,
    teacherId: entry.teacherId,
    room: nextRoom,
  });
  const conflictFlags = mapConflictFlags(conflicts);
  if (conflictFlags.length && !allowConflicts) {
    throw createHttpError(`Schedule conflict detected: ${conflictFlags.join(', ')}`, 409);
  }

  entry.className = nextClassName;
  entry.grade = classDoc.grade || '';
  entry.dayOfWeek = nextDay;
  entry.startTime = nextStartTime;
  entry.endTime = nextEndTime;
  entry.subject = nextSubject;
  entry.room = nextRoom;
  entry.status = ['draft', 'approved', 'rejected'].includes(nextStatus) ? nextStatus : 'approved';
  entry.conflictFlags = conflictFlags;
  entry.changeLog = Array.isArray(entry.changeLog) ? entry.changeLog : [];
  entry.changeLog.push({
    action: 'update',
    actorId: actor.id,
    actorRole: actor.role,
    summary: 'Schedule entry updated.',
    at: new Date(),
  });
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
  entry.changeLog = Array.isArray(entry.changeLog) ? entry.changeLog : [];
  entry.changeLog.push({
    action: 'delete',
    actorId: actor.id,
    actorRole: actor.role,
    summary: 'Schedule entry soft-deleted.',
    at: new Date(),
  });
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

const suggestAdminScheduleSlot = async (req, res) => {
  try {
    const className = asTrimmed(req.body?.className);
    const teacherId = asTrimmed(req.body?.teacherId);
    const room = asTrimmed(req.body?.room);
    const dayOfWeek = resolveDayOfWeek(req.body?.dayOfWeek || req.body?.day);
    const durationMinutes = Math.max(Number(req.body?.durationMinutes || 45), 15);
    const rangeStart = isValidTime(req.body?.rangeStart) ? asTrimmed(req.body.rangeStart) : '07:30';
    const rangeEnd = isValidTime(req.body?.rangeEnd) ? asTrimmed(req.body.rangeEnd) : '15:30';
    const maxSuggestions = Math.min(Math.max(Number(req.body?.maxSuggestions || 5), 1), 20);

    if (!className || !teacherId || !dayOfWeek) {
      return res.status(400).json({ message: 'Class, teacher, and day are required.' });
    }

    const teacher = await resolveTeacherForSchedule({ teacherId });
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    const dayEntries = await ScheduleEntry.find(
      {
        isActive: true,
        dayOfWeek,
        $or: [{ className }, { teacherId }, ...(room ? [{ room }] : [])],
      },
      { startTime: 1, endTime: 1, className: 1, teacherId: 1, room: 1 }
    ).lean();

    const startMinute = toMinutes(rangeStart);
    const endMinute = toMinutes(rangeEnd);
    if (startMinute < 0 || endMinute < 0 || startMinute >= endMinute) {
      return res.status(400).json({ message: 'Scheduling range is invalid.' });
    }

    const suggestions = [];
    for (let minute = startMinute; minute + durationMinutes <= endMinute; minute += 5) {
      const candidateStart = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const candidateEndMinute = minute + durationMinutes;
      const candidateEnd = `${String(Math.floor(candidateEndMinute / 60)).padStart(2, '0')}:${String(candidateEndMinute % 60).padStart(2, '0')}`;

      const conflictFlags = mapConflictFlags(
        dayEntries.reduce(
          (acc, item) => {
            if (!overlaps(candidateStart, candidateEnd, item.startTime, item.endTime)) {
              return acc;
            }
            if (String(item.teacherId) === String(teacherId)) acc.teacherOverlap = true;
            if (item.className === className) acc.classOverlap = true;
            if (room && item.room && item.room === room) acc.roomOverlap = true;
            return acc;
          },
          { teacherOverlap: false, classOverlap: false, roomOverlap: false }
        )
      );

      if (!conflictFlags.length) {
        suggestions.push({
          dayOfWeek,
          startTime: candidateStart,
          endTime: candidateEnd,
          conflictFlags,
          confidence: 1,
        });
      }

      if (suggestions.length >= maxSuggestions) {
        break;
      }
    }

    return res.json({
      suggestions,
      recommended: suggestions[0] || null,
    });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to suggest a schedule slot.');
  }
};

const copyAdminSchedulePattern = async (req, res) => {
  try {
    const fromClassName = asTrimmed(req.body?.fromClassName);
    const toClassName = asTrimmed(req.body?.toClassName);
    const fromDay = resolveDayOfWeek(req.body?.fromDay);
    const toDay = resolveDayOfWeek(req.body?.toDay || req.body?.fromDay);
    const allowConflicts = req.body?.allowConflicts === true;

    if (!fromClassName || !toClassName) {
      return res.status(400).json({ message: 'Source and target classes are required.' });
    }

    const sourceQuery = {
      className: fromClassName,
      isActive: true,
      dayOfWeek: fromDay || { $in: SCHOOL_DAY_RANGE },
    };
    const sourceEntries = await ScheduleEntry.find(sourceQuery).sort({ dayOfWeek: 1, startTime: 1 }).lean();
    if (!sourceEntries.length) {
      return res.status(404).json({ message: 'No source schedule entries found to copy.' });
    }

    const createdEntries = [];
    const skipped = [];
    for (let index = 0; index < sourceEntries.length; index += 1) {
      const source = sourceEntries[index];
      try {
        // eslint-disable-next-line no-await-in-loop
        const created = await createScheduleEntryCore({
          actor: req.user,
          body: {
            className: toClassName,
            teacherId: String(source.teacherId),
            subject: source.subject,
            dayOfWeek: toDay || source.dayOfWeek,
            startTime: source.startTime,
            endTime: source.endTime,
            room: source.room || '',
            sourceType: 'pattern_copy',
            patternKey: asTrimmed(req.body?.patternKey) || `${fromClassName}->${toClassName}`,
            copiedFromEntryId: String(source._id),
            allowConflicts,
          },
          mode: 'admin',
        });
        createdEntries.push(created);
      } catch (copyError) {
        skipped.push({
          sourceEntryId: String(source._id),
          reason: copyError.message || 'Failed to copy row.',
        });
      }
    }

    const classMetaByName = await getClassMeta([toClassName]);
    return res.json({
      copiedCount: createdEntries.length,
      skippedCount: skipped.length,
      skipped,
      entries: createdEntries.map((item) => mapScheduleEntry(item.toObject(), classMetaByName)),
    });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to copy schedule pattern.');
  }
};

const previewAdminScheduleImport = async (req, res) => {
  try {
    const className = asTrimmed(req.body?.className);
    const teacherId = asTrimmed(req.body?.teacherId);
    const ocrText = asTrimmed(req.body?.ocrText);
    const fileDataUrl = asTrimmed(req.body?.fileDataUrl);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (!className || !teacherId) {
      return res.status(400).json({ message: 'Class and teacher are required for schedule OCR preview.' });
    }

    const extraction = await extractScheduleRows({
      rows,
      ocrText,
      fileDataUrl,
    });

    const teacher = await resolveTeacherForSchedule({ teacherId });
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }

    const detectedRows = [];
    for (let index = 0; index < (extraction.rows || []).length; index += 1) {
      const row = extraction.rows[index] || {};
      const dayOfWeek = resolveDayOfWeek(row.day);
      const startTime = asTrimmed(row.startTime);
      const endTime = asTrimmed(row.endTime);
      const subject = asTrimmed(row.subject);
      const room = asTrimmed(row.room);
      const rowIssues = [];

      if (!dayOfWeek) rowIssues.push('invalid_day');
      if (!validateTimeRange(startTime, endTime)) rowIssues.push('invalid_time_range');
      if (!subject) rowIssues.push('missing_subject');

      let conflictFlags = [];
      if (!rowIssues.length) {
        // eslint-disable-next-line no-await-in-loop
        const conflicts = await findEntryConflicts({
          className,
          dayOfWeek,
          startTime,
          endTime,
          teacherId,
          room,
        });
        conflictFlags = mapConflictFlags(conflicts);
      }

      detectedRows.push({
        rowIndex: index,
        className,
        teacherId,
        teacherName: teacher.name || '',
        day: row.day || '',
        dayOfWeek,
        startTime,
        endTime,
        subject,
        room,
        sourceType: extraction.source || 'ocr',
        issues: rowIssues,
        conflictFlags,
        allowInsert: !rowIssues.length,
      });
    }

    const summary = {
      totalRows: detectedRows.length,
      validRows: detectedRows.filter((item) => item.allowInsert).length,
      conflictRows: detectedRows.filter((item) => item.conflictFlags.length > 0).length,
      invalidRows: detectedRows.filter((item) => item.issues.length > 0).length,
    };

    return res.json({
      confirmationRequired: true,
      extractionSource: extraction.source || 'ocr',
      notes: extraction.notes || [],
      summary,
      rows: detectedRows,
    });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to preview schedule OCR import.');
  }
};

const confirmAdminScheduleImport = async (req, res) => {
  try {
    const className = asTrimmed(req.body?.className);
    const teacherId = asTrimmed(req.body?.teacherId);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const allowConflicts = req.body?.allowConflicts === true;

    if (!className || !teacherId || !rows.length) {
      return res.status(400).json({ message: 'Class, teacher, and rows are required.' });
    }

    const createdEntries = [];
    const skipped = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      if (row.skip === true) {
        skipped.push({ rowIndex: Number(row.rowIndex ?? index), reason: 'row_skipped' });
        continue;
      }

      try {
        // eslint-disable-next-line no-await-in-loop
        const created = await createScheduleEntryCore({
          actor: req.user,
          body: {
            className,
            teacherId,
            subject: row.subject,
            dayOfWeek: row.dayOfWeek || row.day,
            startTime: row.startTime,
            endTime: row.endTime,
            room: row.room,
            sourceType: 'ocr',
            allowConflicts,
          },
          mode: 'admin',
        });
        createdEntries.push(created);
      } catch (createError) {
        skipped.push({
          rowIndex: Number(row.rowIndex ?? index),
          reason: createError.message || 'insert_failed',
        });
      }
    }

    const classMetaByName = await getClassMeta([className]);
    return res.json({
      createdCount: createdEntries.length,
      skippedCount: skipped.length,
      skipped,
      entries: createdEntries.map((item) => mapScheduleEntry(item.toObject(), classMetaByName)),
    });
  } catch (error) {
    return respondWithScheduleError(res, error, 'Failed to confirm schedule OCR import.');
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
  suggestAdminScheduleSlot,
  copyAdminSchedulePattern,
  previewAdminScheduleImport,
  confirmAdminScheduleImport,
};
