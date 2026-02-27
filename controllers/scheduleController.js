const ClassModel = require('../models/Class');
const ScheduleEntry = require('../models/ScheduleEntry');
const User = require('../models/User');

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
    return res.status(500).json({ message: error.message || 'Failed to load student schedule.' });
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
    return res.status(500).json({ message: error.message || 'Failed to load teacher schedule.' });
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
    return res.status(500).json({ message: error.message || 'Failed to load schedule overview.' });
  }
};

module.exports = {
  getAdminScheduleOverview,
  getStudentWeeklySchedule,
  getTeacherWeeklySchedule,
};
