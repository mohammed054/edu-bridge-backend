const mongoose = require('mongoose');
const AttendanceRecord = require('../models/AttendanceRecord');
const User = require('../models/User');
const { writeAuditLog } = require('../services/auditLogService');
const { sendServerError } = require('../utils/safeError');

const asTrimmed = (value) => String(value || '').trim();

const hasSubjectAccess = (teacherSubjects, subject) =>
  (teacherSubjects || []).some(
    (entry) => String(entry || '').toLowerCase() === String(subject || '').toLowerCase()
  );

const toDayStart = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(asTrimmed(value));

const writeAudit = (req, { action, entityType, entityId, metadata = {} }) =>
  writeAuditLog({
    actorId: req.user?.id,
    actorRole: req.user?.role,
    action,
    entityType,
    entityId,
    metadata,
    ipAddress: req.ip,
    userAgent: req.headers?.['user-agent'] || '',
  });

const mapRecord = (record) => ({
  id: String(record._id),
  className: record.className,
  subject: record.subject,
  attendanceDate: record.attendanceDate,
  slotStartTime: record.slotStartTime || '',
  slotEndTime: record.slotEndTime || '',
  teacherId: String(record.teacherId),
  teacherName: record.teacherName || '',
  entries: (record.entries || []).map((entry) => ({
    studentId: String(entry.studentId),
    studentName: entry.studentName || '',
    status: entry.status,
    markedAt: entry.markedAt,
  })),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const mapSummary = (bucket) => {
  const weightedPresent = bucket.present + bucket.late * 0.5;
  const attendancePercentage = bucket.total ? (weightedPresent / bucket.total) * 100 : 0;

  return {
    studentId: bucket.studentId,
    studentName: bucket.studentName,
    present: bucket.present,
    absent: bucket.absent,
    late: bucket.late,
    total: bucket.total,
    attendancePercentage: Number(attendancePercentage.toFixed(2)),
  };
};

const markAttendance = async (req, res) => {
  try {
    const className = asTrimmed(req.body?.className);
    const subject = asTrimmed(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const attendanceDate = toDayStart(req.body?.attendanceDate);
    const slotStartTime = asTrimmed(req.body?.slotStartTime);
    const slotEndTime = asTrimmed(req.body?.slotEndTime);
    const entriesInput = Array.isArray(req.body?.entries) ? req.body.entries : [];

    if (!className || !subject || !attendanceDate || !entriesInput.length) {
      return res.status(400).json({ message: 'Attendance payload is incomplete.' });
    }

    if (!req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'You are not allowed to mark attendance for this class.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'You are not allowed to mark attendance for this subject.' });
    }

    const normalizedEntries = [...new Map(entriesInput.map((item) => [asTrimmed(item.studentId), item])).values()]
      .map((item) => ({
        studentId: asTrimmed(item.studentId),
        status: asTrimmed(item.status).toLowerCase(),
      }))
      .filter((item) => item.studentId && ['present', 'absent', 'late'].includes(item.status));

    if (!normalizedEntries.length) {
      return res.status(400).json({ message: 'At least one valid attendance entry is required.' });
    }

    if (normalizedEntries.some((item) => !isValidObjectId(item.studentId))) {
      return res.status(400).json({ message: 'Attendance list contains invalid student identifiers.' });
    }

    const students = await User.find(
      {
        _id: { $in: normalizedEntries.map((item) => item.studentId) },
        role: 'student',
        classes: className,
      },
      { name: 1 }
    ).lean();

    const studentById = students.reduce((acc, student) => {
      acc[String(student._id)] = student;
      return acc;
    }, {});

    if (students.length !== normalizedEntries.length) {
      return res.status(403).json({ message: 'Attendance list includes unauthorized students.' });
    }

    const mappedEntries = normalizedEntries
      .map((item) => ({
        studentId: item.studentId,
        studentName: studentById[item.studentId]?.name || '',
        status: item.status,
        markedAt: new Date(),
      }))
      .sort((left, right) => String(left.studentName || '').localeCompare(String(right.studentName || '')));

    const existing = await AttendanceRecord.findOne({
      className,
      subject,
      teacherId: req.user.id,
      attendanceDate,
      slotStartTime,
    }).lean();

    const record = await AttendanceRecord.findOneAndUpdate(
      {
        className,
        subject,
        teacherId: req.user.id,
        attendanceDate,
        slotStartTime,
      },
      {
        $set: {
          className,
          subject,
          teacherId: req.user.id,
          teacherName: req.user.name || '',
          attendanceDate,
          slotStartTime,
          slotEndTime,
          entries: mappedEntries,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    await writeAudit(req, {
      action: existing ? 'attendance.update' : 'attendance.create',
      entityType: 'attendance_record',
      entityId: String(record._id),
      metadata: {
        className: record.className,
        subject: record.subject,
        attendanceDate: record.attendanceDate,
        entriesCount: (record.entries || []).length,
      },
    });

    return res.status(201).json({ attendance: mapRecord(record) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to mark attendance.');
  }
};

const getTeacherAttendanceSummary = async (req, res) => {
  try {
    const className = asTrimmed(req.query?.className);
    const subject = asTrimmed(req.query?.subject);
    const from = toDayStart(req.query?.from);
    const to = toDayStart(req.query?.to);

    if (className && !req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'You are not allowed to view this class attendance.' });
    }

    if (subject && !hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'You are not allowed to view this subject attendance.' });
    }

    const query = {
      teacherId: req.user.id,
      className: className || { $in: req.user.classes || [] },
      attendanceDate: {
        $gte: from || toDayStart(Date.now() - 30 * 24 * 60 * 60 * 1000),
        $lte: to || toDayStart(new Date()),
      },
    };

    if (subject) {
      query.subject = subject;
    }

    const records = await AttendanceRecord.find(query, { entries: 1 }).lean();
    const summaryByStudent = {};

    records.forEach((record) => {
      (record.entries || []).forEach((entry) => {
        const studentId = String(entry.studentId || '');
        if (!studentId) {
          return;
        }

        if (!summaryByStudent[studentId]) {
          summaryByStudent[studentId] = {
            studentId,
            studentName: entry.studentName || '',
            present: 0,
            absent: 0,
            late: 0,
            total: 0,
          };
        }

        const status = asTrimmed(entry.status).toLowerCase();
        if (status === 'present') {
          summaryByStudent[studentId].present += 1;
        } else if (status === 'absent') {
          summaryByStudent[studentId].absent += 1;
        } else if (status === 'late') {
          summaryByStudent[studentId].late += 1;
        }

        summaryByStudent[studentId].total += 1;
      });
    });

    const summary = Object.values(summaryByStudent)
      .map(mapSummary)
      .sort((left, right) => String(left.studentName || '').localeCompare(String(right.studentName || '')));

    return res.json({ summary });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load attendance summary.');
  }
};

const getStudentAttendanceSummary = async (req, res) => {
  try {
    const sinceDate = toDayStart(req.query?.from) || toDayStart(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const student = await User.findOne({ _id: req.user.id, role: 'student' }, { classes: 1 }).lean();
    const className = student?.classes?.[0] || '';

    if (!className) {
      return res.json({
        className: '',
        present: 0,
        absent: 0,
        late: 0,
        total: 0,
        attendancePercentage: 0,
      });
    }

    const records = await AttendanceRecord.find(
      {
        className,
        attendanceDate: { $gte: sinceDate },
      },
      { entries: 1 }
    ).lean();

    const bucket = {
      studentId: req.user.id,
      studentName: req.user.name || '',
      present: 0,
      absent: 0,
      late: 0,
      total: 0,
    };

    records.forEach((record) => {
      const entry = (record.entries || []).find((item) => String(item.studentId) === String(req.user.id));
      if (!entry) {
        return;
      }

      const status = asTrimmed(entry.status).toLowerCase();
      if (status === 'present') {
        bucket.present += 1;
      } else if (status === 'absent') {
        bucket.absent += 1;
      } else if (status === 'late') {
        bucket.late += 1;
      }

      bucket.total += 1;
    });

    const summary = mapSummary(bucket);
    return res.json({
      className,
      ...summary,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load attendance summary.');
  }
};

module.exports = {
  getStudentAttendanceSummary,
  getTeacherAttendanceSummary,
  markAttendance,
};
