const mongoose = require('mongoose');
const AttendanceRecord = require('../models/AttendanceRecord');
const ClassModel = require('../models/Class');
const Feedback = require('../models/Feedback');
const Incident = require('../models/Incident');
const Notification = require('../models/Notification');
const SavedView = require('../models/SavedView');
const ScheduleEntry = require('../models/ScheduleEntry');
const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');
const SystemSetting = require('../models/SystemSetting');
const User = require('../models/User');
const { buildAdminIntelligenceOverview } = require('../services/intelligenceService');
const { DEFAULT_PERMISSION_MATRIX } = require('../services/rbacService');
const { sendServerError } = require('../utils/safeError');

const asTrimmed = (value) => String(value || '').trim();
const toLower = (value) => asTrimmed(value).toLowerCase();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(asTrimmed(value));
const toInt = (value, fallback = 0) =>
  (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);

const parsePagination = (query = {}) => {
  const page = Math.max(toInt(query.page, 1), 1);
  const pageSize = Math.min(Math.max(toInt(query.pageSize, 25), 1), 200);
  return { page, pageSize, skip: (page - 1) * pageSize };
};

const toCsv = (headers, rows) => {
  const escapeCsv = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n');
};

const extractStudentGrade = (student) => {
  const marks = Array.isArray(student?.examMarks) ? student.examMarks : [];
  if (!marks.length) return 0;
  const total = marks.reduce((sum, mark) => {
    const raw = mark.rawScore == null ? Number(mark.score || 0) : Number(mark.rawScore || 0);
    const maxMarks = Number(mark.maxMarks || 100) || 100;
    return sum + (raw / maxMarks) * 100;
  }, 0);
  return Number((total / marks.length).toFixed(2));
};

const mapRiskByStudentId = (insights) =>
  (insights?.weeklySnapshots || []).reduce((acc, item) => {
    const id = String(item.studentId || '');
    if (id) acc[id] = toLower(item.riskStatus || 'low');
    return acc;
  }, {});

const ensureSystemSetting = async (institutionId = 'hikmah-main') => {
  const existing = await SystemSetting.findOne({ institutionId });
  if (existing) return existing;
  return SystemSetting.create({
    institutionId,
    institutionName: 'Hikmah School',
    currentAcademicYear: '2025-2026',
    defaultTimezone: 'Asia/Dubai',
    defaultLocale: 'ar-AE',
    campuses: [
      {
        campusId: 'main-campus',
        name: 'Main Campus',
        timezone: 'Asia/Dubai',
        locale: 'ar-AE',
        isActive: true,
      },
    ],
    academicYears: [{ yearId: '2025-2026', label: '2025-2026', state: 'active' }],
    permissionMatrix: DEFAULT_PERMISSION_MATRIX,
  });
};

const getEnterpriseHierarchy = async (req, res) => {
  try {
    const institutionId = req.user.institutionId || 'hikmah-main';
    const [setting, classes, students, teachers] = await Promise.all([
      ensureSystemSetting(institutionId),
      ClassModel.find({ institutionId, isArchived: { $ne: true } }).lean(),
      User.find({ institutionId, role: 'student', archiveMode: { $ne: true } }, { name: 1, classes: 1 }).lean(),
      User.find({ institutionId, role: 'teacher', isActive: { $ne: false } }, { name: 1, classes: 1, subject: 1 }).lean(),
    ]);

    const hierarchy = {};
    classes.forEach((classItem) => {
      const year = classItem.academicYear || setting.currentAcademicYear || 'unassigned';
      const grade = classItem.grade || 'unassigned';
      if (!hierarchy[year]) hierarchy[year] = {};
      if (!hierarchy[year][grade]) hierarchy[year][grade] = [];
      hierarchy[year][grade].push({
        id: String(classItem._id),
        name: classItem.name,
        section: classItem.section || '',
        capacity: Number(classItem.capacity || 35),
        students: students
          .filter((student) => (student.classes || [])[0] === classItem.name)
          .map((student) => ({ id: String(student._id), name: student.name || '' })),
        teachers: teachers
          .filter((teacher) => (teacher.classes || []).includes(classItem.name))
          .map((teacher) => ({
            id: String(teacher._id),
            name: teacher.name || '',
            subject: teacher.subject || '',
          })),
      });
    });

    return res.json({
      institution: { institutionId, name: setting.institutionName },
      currentAcademicYear: setting.currentAcademicYear || '',
      campuses: setting.campuses || [],
      academicYears: setting.academicYears || [],
      hierarchy,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to build hierarchy.');
  }
};

const getEnterpriseDashboard = async (req, res) => {
  try {
    const grade = asTrimmed(req.query?.grade);
    const classNameFilter = asTrimmed(req.query?.className);
    const classQuery = { isArchived: { $ne: true } };
    if (grade) classQuery.grade = grade;
    if (classNameFilter) classQuery.name = classNameFilter;

    const [insights, classes, entries, notifications, responseCounts, surveyCount, pendingTickets] = await Promise.all([
      buildAdminIntelligenceOverview(),
      ClassModel.find(classQuery, { name: 1, grade: 1, capacity: 1 }).lean(),
      ScheduleEntry.find(
        { isActive: true, ...(classNameFilter ? { className: classNameFilter } : {}) },
        { className: 1, teacherName: 1, dayOfWeek: 1, startTime: 1, endTime: 1, room: 1, conflictFlags: 1 }
      ).lean(),
      Notification.find({ recipientRole: 'admin' }, { workflowStatus: 1, category: 1, isRead: 1, priorityWeight: 1 }).sort({ createdAt: -1 }).limit(300).lean(),
      SurveyResponse.aggregate([{ $group: { _id: '$surveyId', responses: { $sum: 1 } } }]),
      Survey.countDocuments({}),
      Feedback.countDocuments({ ticketStatus: { $in: ['open', 'pending'] } }),
    ]);

    const studentCountByClass = await User.aggregate([
      { $match: { role: 'student', archiveMode: { $ne: true } } },
      { $project: { className: { $arrayElemAt: ['$classes', 0] } } },
      { $group: { _id: '$className', count: { $sum: 1 } } },
    ]);

    const classCapacityUtilization = classes.map((classItem) => {
      const found = studentCountByClass.find((item) => item._id === classItem.name);
      const enrolled = Number(found?.count || 0);
      const capacity = Number(classItem.capacity || 35) || 35;
      return {
        className: classItem.name,
        enrolled,
        capacity,
        utilizationRate: Number(((enrolled / capacity) * 100).toFixed(2)),
      };
    });

    const workload = entries.reduce((acc, entry) => {
      const key = entry.teacherName || 'Unknown';
      if (!acc[key]) acc[key] = 0;
      acc[key] += 1;
      return acc;
    }, {});

    const totalSurveyResponses = responseCounts.reduce((sum, item) => sum + Number(item.responses || 0), 0);
    const surveyParticipationRate = surveyCount
      ? Number((((responseCounts.length || 0) / Number(surveyCount || 1)) * 100).toFixed(2))
      : 0;
    const classNameSet = new Set(classes.map((item) => item.name));
    const filteredRisk = (insights.studentsAtRisk || []).filter((item) =>
      classNameSet.size ? classNameSet.has(item.className) : true
    );

    return res.json({
      generatedAt: new Date().toISOString(),
      filters: { grade: grade || '', className: classNameFilter || '' },
      attendanceRateTrends: insights.weeklySnapshots || [],
      highRiskStudents: filteredRisk,
      classCapacityUtilization,
      teacherWorkloadHeatmap: Object.entries(workload)
        .map(([teacherName, sessions]) => ({ teacherName, sessions }))
        .sort((left, right) => right.sessions - left.sessions)
        .slice(0, 20),
      scheduleConflicts: entries
        .filter((entry) => (entry.conflictFlags || []).length > 0)
        .map((entry) => ({
          id: String(entry._id),
          className: entry.className || '',
          teacherName: entry.teacherName || '',
          dayOfWeek: Number(entry.dayOfWeek || 0),
          startTime: entry.startTime || '',
          endTime: entry.endTime || '',
          room: entry.room || '',
          conflictFlags: entry.conflictFlags || [],
        })),
      pendingFeedbackTickets: pendingTickets,
      notificationQueue: {
        unread: notifications.filter((item) => item.isRead !== true).length,
        escalated: notifications.filter((item) => item.workflowStatus === 'escalated').length,
        highPriority: notifications.filter((item) => Number(item.priorityWeight || 1) >= 4).length,
      },
      surveyParticipationRate,
      surveyResponseCount: totalSurveyResponses,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to build enterprise dashboard.');
  }
};

const listEnterpriseStudents = async (req, res) => {
  try {
    const { page, pageSize, skip } = parsePagination(req.query);
    const search = asTrimmed(req.query.search);
    const className = asTrimmed(req.query.className);
    const grade = asTrimmed(req.query.grade);
    const riskLevel = toLower(req.query.riskLevel);
    const lifecycleState = toLower(req.query.lifecycleState);
    const sortBy = asTrimmed(req.query.sortBy) || 'name';
    const sortOrder = toLower(req.query.sortOrder) === 'desc' ? -1 : 1;

    const classFilter = {};
    if (className) classFilter.name = className;
    if (grade) classFilter.grade = grade;

    const classes = await ClassModel.find(classFilter, { name: 1, grade: 1 }).lean();
    const classNames = classes.map((item) => item.name);
    const gradeByClass = classes.reduce((acc, item) => {
      acc[item.name] = item.grade || '';
      return acc;
    }, {});

    const query = {
      role: 'student',
      archiveMode: { $ne: true },
      ...(classNames.length ? { classes: { $in: classNames } } : className || grade ? { _id: null } : {}),
      ...(lifecycleState ? { studentLifecycleState: lifecycleState } : {}),
    };

    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: pattern }, { email: pattern }];
    }

    const insights = await buildAdminIntelligenceOverview();
    const riskMap = mapRiskByStudentId(insights);
    let totalCount = 0;
    let rows = [];

    if (riskLevel) {
      const allStudents = await User.find(query).sort({ [sortBy]: sortOrder, createdAt: -1 }).lean();
      const filtered = allStudents
        .map((student) => {
          const classKey = (student.classes || [])[0] || '';
          return {
            id: String(student._id),
            name: student.name || '',
            email: student.email || '',
            className: classKey,
            grade: gradeByClass[classKey] || '',
            riskLevel: riskMap[String(student._id)] || 'low',
            attendanceMisses: Number(student.absentDays || 0),
            lifecycleState: student.studentLifecycleState || 'active',
            averageGrade: extractStudentGrade(student),
            isActive: student.isActive !== false,
          };
        })
        .filter((row) => row.riskLevel === riskLevel);
      totalCount = filtered.length;
      rows = filtered.slice(skip, skip + pageSize);
    } else {
      totalCount = await User.countDocuments(query);
      const students = await User.find(query).sort({ [sortBy]: sortOrder, createdAt: -1 }).skip(skip).limit(pageSize).lean();
      rows = students.map((student) => {
        const classKey = (student.classes || [])[0] || '';
        return {
          id: String(student._id),
          name: student.name || '',
          email: student.email || '',
          className: classKey,
          grade: gradeByClass[classKey] || '',
          riskLevel: riskMap[String(student._id)] || 'low',
          attendanceMisses: Number(student.absentDays || 0),
          lifecycleState: student.studentLifecycleState || 'active',
          averageGrade: extractStudentGrade(student),
          isActive: student.isActive !== false,
        };
      });
    }

    return res.json({
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      rows,
      availableFilters: {
        classNames: [...new Set(classes.map((item) => item.name))],
        grades: [...new Set(classes.map((item) => item.grade).filter(Boolean))],
        riskLevels: ['low', 'medium', 'high'],
        lifecycleStates: ['active', 'probation', 'academic_warning', 'suspended', 'graduated', 'transferred', 'archived'],
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to list enterprise students.');
  }
};

const bulkUpdateEnterpriseStudents = async (req, res) => {
  try {
    const studentIds = Array.isArray(req.body?.studentIds)
      ? req.body.studentIds.map((item) => asTrimmed(item)).filter((item) => isValidObjectId(item))
      : [];
    const action = toLower(req.body?.action);
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};

    if (!studentIds.length || !action) {
      return res.status(400).json({ message: 'Bulk action requires studentIds and action.' });
    }

    const update = {};
    if (action === 'archive') update.archiveMode = true;
    if (action === 'restore') update.archiveMode = false;
    if (action === 'activate') update.isActive = true;
    if (action === 'deactivate') update.isActive = false;
    if (action === 'set_lifecycle') update.studentLifecycleState = asTrimmed(payload.lifecycleState) || 'active';
    if (action === 'move_class') update.classes = [asTrimmed(payload.className)].filter(Boolean);

    if (!Object.keys(update).length) {
      return res.status(400).json({ message: 'Unsupported bulk action.' });
    }

    const result = await User.updateMany({ _id: { $in: studentIds }, role: 'student' }, { $set: update });
    return res.json({
      success: true,
      action,
      matchedCount: Number(result.matchedCount || 0),
      modifiedCount: Number(result.modifiedCount || 0),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to execute student bulk action.');
  }
};

const exportEnterpriseStudents = async (req, res) => {
  try {
    const className = asTrimmed(req.query.className);
    const students = await User.find(
      { role: 'student', ...(className ? { classes: className } : {}) },
      { name: 1, email: 1, classes: 1, studentLifecycleState: 1, absentDays: 1, negativeReports: 1, isActive: 1 }
    ).lean();

    const csv = toCsv(
      ['name', 'email', 'className', 'lifecycleState', 'absentDays', 'negativeReports', 'isActive'],
      students.map((student) => [
        student.name || '',
        student.email || '',
        (student.classes || [])[0] || '',
        student.studentLifecycleState || 'active',
        Number(student.absentDays || 0),
        Number(student.negativeReports || 0),
        student.isActive !== false ? 'true' : 'false',
      ])
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"students-${new Date().toISOString().slice(0, 10)}.csv\"`);
    return res.send(csv);
  } catch (error) {
    return sendServerError(res, error, 'Failed to export enterprise students.');
  }
};
const listEnterpriseTeachers = async (req, res) => {
  try {
    const { page, pageSize, skip } = parsePagination(req.query);
    const search = asTrimmed(req.query.search);
    const subject = asTrimmed(req.query.subject);

    const query = { role: 'teacher', ...(subject ? { subject } : {}) };
    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: pattern }, { email: pattern }];
    }

    const totalCount = await User.countDocuments(query);
    const teachers = await User.find(query).sort({ name: 1 }).skip(skip).limit(pageSize).lean();
    const entries = await ScheduleEntry.find({ isActive: true, teacherId: { $in: teachers.map((item) => item._id) } }, { teacherId: 1, startTime: 1, endTime: 1, conflictFlags: 1 }).lean();

    const loadMap = entries.reduce((acc, entry) => {
      const key = String(entry.teacherId);
      if (!acc[key]) acc[key] = { sessions: 0, hours: 0, conflicts: 0 };
      acc[key].sessions += 1;
      acc[key].conflicts += (entry.conflictFlags || []).length ? 1 : 0;
      const startMinutes = Number(entry.startTime?.slice(0, 2)) * 60 + Number(entry.startTime?.slice(3, 5));
      const endMinutes = Number(entry.endTime?.slice(0, 2)) * 60 + Number(entry.endTime?.slice(3, 5));
      acc[key].hours += Math.max(0, endMinutes - startMinutes) / 60;
      return acc;
    }, {});

    const rows = teachers.map((teacher) => {
      const load = loadMap[String(teacher._id)] || { sessions: 0, hours: 0, conflicts: 0 };
      return {
        id: String(teacher._id),
        name: teacher.name || '',
        email: teacher.email || '',
        subject: teacher.subject || teacher.subjects?.[0] || '',
        classes: teacher.classes || [],
        weeklySessions: load.sessions,
        weeklyHours: Number(load.hours.toFixed(2)),
        conflictWarnings: load.conflicts,
        workloadState: load.hours > 25 ? 'overload' : load.hours < 10 ? 'underload' : 'balanced',
      };
    });

    return res.json({ page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize), rows });
  } catch (error) {
    return sendServerError(res, error, 'Failed to list enterprise teachers.');
  }
};

const listEnterpriseClasses = async (_req, res) => {
  try {
    const [classes, students, teachers, attendanceRecords, scheduleEntries] = await Promise.all([
      ClassModel.find({ isArchived: { $ne: true } }).sort({ name: 1 }).lean(),
      User.find({ role: 'student', archiveMode: { $ne: true } }, { classes: 1, examMarks: 1 }).lean(),
      User.find({ role: 'teacher', isActive: { $ne: false } }, { classes: 1 }).lean(),
      AttendanceRecord.find({}, { className: 1, entries: 1 }).lean(),
      ScheduleEntry.find({ isActive: true }, { className: 1 }).lean(),
    ]);

    const rows = classes.map((classItem) => {
      const classStudents = students.filter((student) => (student.classes || [])[0] === classItem.name);
      const classTeachers = teachers.filter((teacher) => (teacher.classes || []).includes(classItem.name));
      const classAttendance = attendanceRecords.filter((record) => record.className === classItem.name);
      const classSchedule = scheduleEntries.filter((entry) => entry.className === classItem.name);
      const totalAttendance = classAttendance.reduce((sum, record) => sum + (record.entries || []).length, 0);
      const presentAttendance = classAttendance.reduce((sum, record) => sum + (record.entries || []).filter((entry) => entry.status === 'present').length, 0);

      return {
        id: String(classItem._id),
        name: classItem.name,
        grade: classItem.grade || '',
        section: classItem.section || '',
        capacity: Number(classItem.capacity || 35),
        enrolled: classStudents.length,
        utilizationRate: classItem.capacity ? Number(((classStudents.length / Number(classItem.capacity || 1)) * 100).toFixed(2)) : 0,
        teacherCount: classTeachers.length,
        weeklySessions: classSchedule.length,
        performanceAverage: classStudents.length ? Number((classStudents.reduce((sum, student) => sum + extractStudentGrade(student), 0) / classStudents.length).toFixed(2)) : 0,
        attendanceRate: totalAttendance ? Number(((presentAttendance / totalAttendance) * 100).toFixed(2)) : 0,
      };
    });

    return res.json({ rows });
  } catch (error) {
    return sendServerError(res, error, 'Failed to list enterprise classes.');
  }
};

const getEnterpriseStudentDetail = async (req, res) => {
  try {
    const studentId = asTrimmed(req.params.id);
    if (!isValidObjectId(studentId)) return res.status(400).json({ message: 'Student identifier is invalid.' });

    const student = await User.findOne({ _id: studentId, role: 'student' }).lean();
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const className = (student.classes || [])[0] || '';
    const [schedule, attendanceRecords, incidents, feedback, surveys] = await Promise.all([
      ScheduleEntry.find({ className, isActive: true }, { dayOfWeek: 1, startTime: 1, endTime: 1, subject: 1, teacherName: 1, room: 1, changeLog: 1 }).sort({ dayOfWeek: 1, startTime: 1 }).lean(),
      AttendanceRecord.find({ className }, { attendanceDate: 1, entries: 1 }).sort({ attendanceDate: -1 }).limit(120).lean(),
      Incident.find({ studentId }, { severity: 1, subject: 1, description: 1, createdAt: 1, parentNotification: 1 }).sort({ createdAt: -1 }).limit(120).lean(),
      Feedback.find({ studentId }, { subject: 1, message: 1, senderRole: 1, workflowStatus: 1, ticketStatus: 1, replies: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(200).lean(),
      SurveyResponse.find({ respondentId: studentId }, { surveyId: 1, createdAt: 1 }).lean(),
    ]);

    const attendanceHeatmap = attendanceRecords.map((record) => {
      const entry = (record.entries || []).find((item) => String(item.studentId) === String(studentId));
      return { date: record.attendanceDate, status: entry?.status || 'unmarked' };
    });

    return res.json({
      student: {
        id: String(student._id),
        name: student.name || '',
        email: student.email || '',
        className,
        lifecycleState: student.studentLifecycleState || 'active',
        archiveMode: student.archiveMode === true,
      },
      overview: {
        averageGrade: extractStudentGrade(student),
        absentDays: Number(student.absentDays || 0),
        negativeReports: Number(student.negativeReports || 0),
      },
      academicPerformanceGraph: (student.examMarks || [])
        .map((mark) => ({
          examTitle: mark.examTitle || 'Assessment',
          subject: mark.subject || '',
          score: mark.rawScore == null ? Number(mark.score || 0) : Number(mark.rawScore || 0),
          maxMarks: Number(mark.maxMarks || 100),
          updatedAt: mark.updatedAt || null,
        }))
        .sort((left, right) => new Date(left.updatedAt) - new Date(right.updatedAt)),
      attendanceHeatmap,
      schedulePreview: schedule,
      incidentHistory: incidents,
      parentContactBlock: {
        contactAvailable: true,
        message: 'Parent contact is linked through parent portal accounts.',
      },
      communicationLog: feedback.map((item) => ({
        id: String(item._id),
        subject: item.subject || '',
        message: item.message || '',
        senderRole: item.senderRole || '',
        workflowStatus: item.workflowStatus || '',
        ticketStatus: item.ticketStatus || 'open',
        createdAt: item.createdAt,
        repliesCount: Array.isArray(item.replies) ? item.replies.length : 0,
      })),
      surveyParticipation: {
        totalResponses: surveys.length,
        responseIds: surveys.map((item) => String(item._id)),
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load enterprise student detail.');
  }
};

const getEnterpriseTeacherDetail = async (req, res) => {
  try {
    const teacherId = asTrimmed(req.params.id);
    if (!isValidObjectId(teacherId)) return res.status(400).json({ message: 'Teacher identifier is invalid.' });

    const teacher = await User.findOne({ _id: teacherId, role: 'teacher' }).lean();
    if (!teacher) return res.status(404).json({ message: 'Teacher not found.' });

    const [schedule, attendanceRecords, feedback] = await Promise.all([
      ScheduleEntry.find({ teacherId, isActive: true }, { className: 1, subject: 1, dayOfWeek: 1, startTime: 1, endTime: 1, room: 1, conflictFlags: 1 }).lean(),
      AttendanceRecord.find({ teacherId }, { className: 1, attendanceDate: 1, entries: 1 }).lean(),
      Feedback.find({ $or: [{ teacherId }, { receiverId: teacherId }] }, { urgency: 1, workflowStatus: 1, className: 1, studentName: 1, createdAt: 1 }).lean(),
    ]);

    const weeklyHours = schedule.reduce((sum, entry) => {
      const start = Number(entry.startTime?.slice(0, 2)) * 60 + Number(entry.startTime?.slice(3, 5));
      const end = Number(entry.endTime?.slice(0, 2)) * 60 + Number(entry.endTime?.slice(3, 5));
      return sum + Math.max(0, end - start) / 60;
    }, 0);

    return res.json({
      teacher: {
        id: String(teacher._id),
        name: teacher.name || '',
        email: teacher.email || '',
        subject: teacher.subject || teacher.subjects?.[0] || '',
        classes: teacher.classes || [],
      },
      groupingBySubject: [{ subject: teacher.subject || teacher.subjects?.[0] || '', classCount: (teacher.classes || []).length }],
      workloadAnalytics: {
        weeklyHours: Number(weeklyHours.toFixed(2)),
        classesAssigned: [...new Set(schedule.map((item) => item.className))].length,
        scheduleConflictWarnings: schedule.filter((item) => (item.conflictFlags || []).length > 0).length,
        attendanceCompletionTracker: attendanceRecords.length,
        gradingBacklogIndicator: 0,
        riskStudentsSummary: feedback.filter((item) => item.urgency === 'high').length,
        upcomingDeadlines: feedback.filter((item) => item.workflowStatus === 'sent').length,
      },
      weeklyHourTracking: schedule,
      conflictWarnings: schedule.filter((item) => (item.conflictFlags || []).length > 0),
      performanceMetrics: {
        attendanceComplianceRate: attendanceRecords.length ? 100 : 0,
        feedbackResponseTimeMetric: 0,
      },
      studentTeacherFeedbackCrossView: feedback,
      parentCommunicationLog: feedback
        .filter((item) => item.workflowStatus === 'reviewed')
        .map((item) => ({
          className: item.className || '',
          studentName: item.studentName || '',
          createdAt: item.createdAt,
        })),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load enterprise teacher detail.');
  }
};

const getEnterpriseClassDetail = async (req, res) => {
  try {
    const classId = asTrimmed(req.params.id);
    if (!isValidObjectId(classId)) return res.status(400).json({ message: 'Class identifier is invalid.' });

    const classItem = await ClassModel.findById(classId).lean();
    if (!classItem) return res.status(404).json({ message: 'Class not found.' });

    const [students, teachers, schedule, attendanceRecords] = await Promise.all([
      User.find({ role: 'student', classes: classItem.name }, { name: 1, email: 1, studentLifecycleState: 1 }).sort({ name: 1 }).lean(),
      User.find({ role: 'teacher', classes: classItem.name }, { name: 1, subject: 1 }).sort({ name: 1 }).lean(),
      ScheduleEntry.find({ className: classItem.name, isActive: true }).sort({ dayOfWeek: 1, startTime: 1 }).lean(),
      AttendanceRecord.find({ className: classItem.name }, { entries: 1 }).lean(),
    ]);

    const totalAttendance = attendanceRecords.reduce((sum, record) => sum + (record.entries || []).length, 0);
    const presentAttendance = attendanceRecords.reduce((sum, record) => sum + (record.entries || []).filter((item) => item.status === 'present').length, 0);

    return res.json({
      class: {
        id: String(classItem._id),
        name: classItem.name,
        grade: classItem.grade || '',
        section: classItem.section || '',
        capacity: Number(classItem.capacity || 35),
        academicYear: classItem.academicYear || '',
      },
      studentRosterPanel: students.map((student) => ({
        id: String(student._id),
        name: student.name || '',
        email: student.email || '',
        lifecycleState: student.studentLifecycleState || 'active',
      })),
      teacherAssignmentPanel: teachers.map((teacher) => ({
        id: String(teacher._id),
        name: teacher.name || '',
        subject: teacher.subject || '',
      })),
      weeklyTimetableView: schedule,
      classPerformanceMetrics: {
        averagePerformance: students.length ? Number((students.reduce((sum, student) => sum + extractStudentGrade(student), 0) / students.length).toFixed(2)) : 0,
        attendanceRate: totalAttendance ? Number(((presentAttendance / totalAttendance) * 100).toFixed(2)) : 0,
      },
      exportRoster: { exportCsvPath: `/api/admin/enterprise/classes/${classItem._id}/roster-export` },
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load enterprise class detail.');
  }
};

const updateEnterpriseClassDetail = async (req, res) => {
  try {
    const classId = asTrimmed(req.params.id);
    if (!isValidObjectId(classId)) return res.status(400).json({ message: 'Class identifier is invalid.' });

    const classItem = await ClassModel.findById(classId);
    if (!classItem) return res.status(404).json({ message: 'Class not found.' });

    if (req.body?.name !== undefined) classItem.name = asTrimmed(req.body.name) || classItem.name;
    if (req.body?.grade !== undefined) classItem.grade = asTrimmed(req.body.grade);
    if (req.body?.section !== undefined) classItem.section = asTrimmed(req.body.section);
    if (req.body?.academicYear !== undefined) classItem.academicYear = asTrimmed(req.body.academicYear);
    if (req.body?.capacity !== undefined) {
      const capacity = Math.max(toInt(req.body.capacity, Number(classItem.capacity || 35)), 1);
      classItem.capacity = capacity;
    }
    if (req.body?.isArchived !== undefined) classItem.isArchived = req.body.isArchived === true;

    await classItem.save();
    return res.json({
      success: true,
      class: {
        id: String(classItem._id),
        name: classItem.name,
        grade: classItem.grade || '',
        section: classItem.section || '',
        capacity: Number(classItem.capacity || 35),
        academicYear: classItem.academicYear || '',
        isArchived: classItem.isArchived === true,
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to update enterprise class.');
  }
};

const exportClassRoster = async (req, res) => {
  try {
    const classId = asTrimmed(req.params.id);
    if (!isValidObjectId(classId)) return res.status(400).json({ message: 'Class identifier is invalid.' });

    const classItem = await ClassModel.findById(classId).lean();
    if (!classItem) return res.status(404).json({ message: 'Class not found.' });

    const students = await User.find({ role: 'student', classes: classItem.name }, { name: 1, email: 1, studentLifecycleState: 1 }).sort({ name: 1 }).lean();
    const csv = toCsv(
      ['name', 'email', 'lifecycleState'],
      students.map((student) => [student.name || '', student.email || '', student.studentLifecycleState || 'active'])
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"class-roster-${classItem.name}.csv\"`);
    return res.send(csv);
  } catch (error) {
    return sendServerError(res, error, 'Failed to export class roster.');
  }
};
const listSavedViews = async (req, res) => {
  try {
    const moduleKey = asTrimmed(req.query.moduleKey);
    const views = await SavedView.find({ ownerId: req.user.id, ...(moduleKey ? { moduleKey } : {}) }).sort({ updatedAt: -1 }).lean();
    return res.json({
      views: views.map((item) => ({
        id: String(item._id),
        moduleKey: item.moduleKey,
        title: item.title,
        filters: item.filters || {},
        sort: item.sort || {},
        columns: item.columns || [],
        isDefault: item.isDefault === true,
        updatedAt: item.updatedAt,
      })),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to list saved views.');
  }
};

const createSavedView = async (req, res) => {
  try {
    const moduleKey = asTrimmed(req.body?.moduleKey);
    const title = asTrimmed(req.body?.title);
    if (!moduleKey || !title) return res.status(400).json({ message: 'moduleKey and title are required.' });
    if (req.body?.isDefault === true) {
      await SavedView.updateMany({ ownerId: req.user.id, moduleKey }, { $set: { isDefault: false } });
    }
    const created = await SavedView.create({
      ownerId: req.user.id,
      ownerRole: req.user.role,
      moduleKey,
      title,
      filters: req.body?.filters || {},
      sort: req.body?.sort || {},
      columns: Array.isArray(req.body?.columns) ? req.body.columns : [],
      isDefault: req.body?.isDefault === true,
    });
    return res.status(201).json({ id: String(created._id) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to create saved view.');
  }
};

const deleteSavedView = async (req, res) => {
  try {
    const id = asTrimmed(req.params.id);
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Saved view identifier is invalid.' });
    const result = await SavedView.deleteOne({ _id: id, ownerId: req.user.id });
    return res.json({ success: Number(result.deletedCount || 0) > 0 });
  } catch (error) {
    return sendServerError(res, error, 'Failed to delete saved view.');
  }
};

const getSystemContext = async (req, res) => {
  try {
    const setting = await ensureSystemSetting(req.user.institutionId || 'hikmah-main');
    return res.json({
      institutionId: setting.institutionId,
      institutionName: setting.institutionName,
      currentAcademicYear: setting.currentAcademicYear,
      defaultTimezone: setting.defaultTimezone,
      defaultLocale: setting.defaultLocale,
      campuses: setting.campuses || [],
      academicYears: setting.academicYears || [],
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load system context.');
  }
};

const updateSystemContext = async (req, res) => {
  try {
    const setting = await ensureSystemSetting(req.user.institutionId || 'hikmah-main');
    if (req.body?.institutionName !== undefined) setting.institutionName = asTrimmed(req.body.institutionName) || setting.institutionName;
    if (req.body?.currentAcademicYear !== undefined) setting.currentAcademicYear = asTrimmed(req.body.currentAcademicYear);
    if (req.body?.defaultTimezone !== undefined) setting.defaultTimezone = asTrimmed(req.body.defaultTimezone);
    if (req.body?.defaultLocale !== undefined) setting.defaultLocale = asTrimmed(req.body.defaultLocale);
    if (Array.isArray(req.body?.campuses)) setting.campuses = req.body.campuses;
    if (Array.isArray(req.body?.academicYears)) setting.academicYears = req.body.academicYears;
    await setting.save();
    return res.json({ success: true });
  } catch (error) {
    return sendServerError(res, error, 'Failed to update system context.');
  }
};

const getPermissionMatrix = async (req, res) => {
  try {
    const setting = await ensureSystemSetting(req.user.institutionId || 'hikmah-main');
    return res.json({
      matrix: setting.permissionMatrix || DEFAULT_PERMISSION_MATRIX,
      actorProfile: req.user.adminProfile || 'none',
      effectivePermissions: req.user.permissionSet || [],
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load permission matrix.');
  }
};

const updatePermissionMatrix = async (req, res) => {
  try {
    if ((req.user.adminProfile || '') !== 'super_admin') {
      return res.status(403).json({ message: 'Only Super Admin can update permission matrix.' });
    }
    const matrix = req.body?.matrix;
    if (!matrix || typeof matrix !== 'object') return res.status(400).json({ message: 'Matrix payload is invalid.' });
    const setting = await ensureSystemSetting(req.user.institutionId || 'hikmah-main');
    setting.permissionMatrix = matrix;
    await setting.save();
    return res.json({ success: true });
  } catch (error) {
    return sendServerError(res, error, 'Failed to update permission matrix.');
  }
};

const listNotificationWorkflow = async (req, res) => {
  try {
    const limit = Math.min(Math.max(toInt(req.query.limit, 200), 1), 1000);
    const workflowStatus = toLower(req.query.workflowStatus);
    const category = toLower(req.query.category);
    const rows = await Notification.find({ ...(workflowStatus ? { workflowStatus } : {}), ...(category ? { category } : {}) })
      .sort({ priorityWeight: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({
      rows: rows.map((item) => ({
        id: String(item._id),
        recipientRole: item.recipientRole || '',
        category: item.category || '',
        urgency: item.urgency || 'low',
        title: item.title || '',
        workflowStatus: item.workflowStatus || 'open',
        priorityWeight: Number(item.priorityWeight || 1),
        assignedToId: item.assignedToId ? String(item.assignedToId) : '',
        escalationLevel: Number(item.escalationLevel || 0),
        dueAt: item.dueAt || null,
        resolvedAt: item.resolvedAt || null,
        requiresAcknowledgement: item.requiresAcknowledgement === true,
      })),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to list notification workflow.');
  }
};

const updateNotificationWorkflow = async (req, res) => {
  try {
    const id = asTrimmed(req.params.id);
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Notification identifier is invalid.' });

    const update = { $set: {} };
    if (req.body?.workflowStatus !== undefined) update.$set.workflowStatus = toLower(req.body.workflowStatus);
    if (req.body?.priorityWeight !== undefined) update.$set.priorityWeight = Math.min(Math.max(toInt(req.body.priorityWeight, 1), 1), 5);
    if (req.body?.assignedToId !== undefined) update.$set.assignedToId = asTrimmed(req.body.assignedToId) || null;
    if (req.body?.assignedToRole !== undefined) update.$set.assignedToRole = toLower(req.body.assignedToRole) || null;
    if (req.body?.requiresAcknowledgement !== undefined) update.$set.requiresAcknowledgement = req.body.requiresAcknowledgement === true;
    if (req.body?.acknowledge === true) update.$set.acknowledgedAt = new Date();
    if (req.body?.workflowStatus === 'resolved') update.$set.resolvedAt = new Date();
    if (req.body?.escalate === true) {
      update.$set.workflowStatus = 'escalated';
      update.$set.escalatedAt = new Date();
      update.$inc = { escalationLevel: 1 };
    }

    const patched = await Notification.findByIdAndUpdate(id, update, { new: true }).lean();
    if (!patched) return res.status(404).json({ message: 'Notification not found.' });
    return res.json({ success: true });
  } catch (error) {
    return sendServerError(res, error, 'Failed to update notification workflow.');
  }
};

const listTicketWorkflow = async (req, res) => {
  try {
    const ticketStatus = toLower(req.query.ticketStatus);
    const priority = toLower(req.query.priority);
    const rows = await Feedback.find(
      {
        feedbackType: { $in: ['student_to_teacher', 'student_to_admin', 'teacher_feedback', 'admin_feedback'] },
        ...(ticketStatus ? { ticketStatus } : {}),
        ...(priority ? { priority } : {}),
      },
      { ticketId: 1, studentName: 1, className: 1, subject: 1, workflowStatus: 1, ticketStatus: 1, priority: 1, urgency: 1, slaDueAt: 1, assignedToId: 1, createdAt: 1, resolvedAt: 1 }
    ).sort({ createdAt: -1 }).limit(1200).lean();

    const now = Date.now();
    return res.json({
      rows: rows.map((item) => ({
        id: String(item._id),
        ticketId: item.ticketId || '',
        studentName: item.studentName || '',
        className: item.className || '',
        subject: item.subject || '',
        workflowStatus: item.workflowStatus || '',
        ticketStatus: item.ticketStatus || 'open',
        priority: item.priority || 'p3',
        urgency: item.urgency || 'low',
        slaDueAt: item.slaDueAt || null,
        slaBreached: item.slaDueAt ? new Date(item.slaDueAt).getTime() < now && item.ticketStatus !== 'resolved' : false,
        assignedToId: item.assignedToId ? String(item.assignedToId) : '',
        createdAt: item.createdAt,
        resolvedAt: item.resolvedAt || null,
      })),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to list ticket workflow.');
  }
};

const updateTicketWorkflow = async (req, res) => {
  try {
    const id = asTrimmed(req.params.id);
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Ticket identifier is invalid.' });

    const patch = {};
    if (req.body?.ticketStatus !== undefined) patch.ticketStatus = toLower(req.body.ticketStatus);
    if (req.body?.priority !== undefined) patch.priority = toLower(req.body.priority);
    if (req.body?.assignedToId !== undefined) patch.assignedToId = asTrimmed(req.body.assignedToId) || null;
    if (req.body?.assignedToRole !== undefined) patch.assignedToRole = toLower(req.body.assignedToRole);
    if (req.body?.slaDueAt !== undefined) patch.slaDueAt = req.body.slaDueAt ? new Date(req.body.slaDueAt) : null;
    if (req.body?.firstResponse === true) patch.firstResponseAt = new Date();
    if (req.body?.ticketStatus === 'resolved') patch.resolvedAt = new Date();
    if (req.body?.escalate === true) patch.escalationCount = toInt(req.body.escalationCount, 1);

    const updated = await Feedback.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ message: 'Ticket not found.' });
    return res.json({ success: true });
  } catch (error) {
    return sendServerError(res, error, 'Failed to update ticket workflow.');
  }
};

const exportTicketWorkflow = async (_req, res) => {
  try {
    const rows = await Feedback.find(
      { feedbackType: { $in: ['student_to_teacher', 'student_to_admin', 'teacher_feedback', 'admin_feedback'] } },
      { ticketId: 1, studentName: 1, className: 1, subject: 1, ticketStatus: 1, priority: 1, slaDueAt: 1, createdAt: 1, resolvedAt: 1 }
    ).sort({ createdAt: -1 }).limit(1500).lean();

    const csv = toCsv(
      ['ticketId', 'studentName', 'className', 'subject', 'ticketStatus', 'priority', 'slaDueAt', 'createdAt', 'resolvedAt'],
      rows.map((item) => [
        item.ticketId || '',
        item.studentName || '',
        item.className || '',
        item.subject || '',
        item.ticketStatus || 'open',
        item.priority || 'p3',
        item.slaDueAt || '',
        item.createdAt || '',
        item.resolvedAt || '',
      ])
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"ticket-workflow-${new Date().toISOString().slice(0, 10)}.csv\"`);
    return res.send(csv);
  } catch (error) {
    return sendServerError(res, error, 'Failed to export ticket workflow.');
  }
};

const listSurveyLifecycle = async (_req, res) => {
  try {
    const now = Date.now();
    const [surveys, responseCounts] = await Promise.all([
      Survey.find({}, { title: 1, audience: 1, publishStatus: 1, deadlineAt: 1, autoCloseAtDeadline: 1, targetGrades: 1, targetClasses: 1, publishedAt: 1, previewEnabled: 1 }).sort({ createdAt: -1 }).lean(),
      SurveyResponse.aggregate([{ $group: { _id: '$surveyId', responses: { $sum: 1 } } }]),
    ]);

    const responseMap = responseCounts.reduce((acc, item) => {
      acc[String(item._id)] = Number(item.responses || 0);
      return acc;
    }, {});

    return res.json({
      rows: surveys.map((survey) => {
        const deadlineMs = survey.deadlineAt ? new Date(survey.deadlineAt).getTime() : null;
        const autoClosed = Boolean(deadlineMs && survey.autoCloseAtDeadline !== false && deadlineMs < now && survey.publishStatus === 'published');
        return {
          id: String(survey._id),
          title: survey.title || '',
          audience: survey.audience || [],
          publishStatus: autoClosed ? 'closed' : survey.publishStatus || 'draft',
          deadlineAt: survey.deadlineAt || null,
          autoCloseAtDeadline: survey.autoCloseAtDeadline !== false,
          previewEnabled: survey.previewEnabled !== false,
          targetGrades: survey.targetGrades || [],
          targetClasses: survey.targetClasses || [],
          responses: responseMap[String(survey._id)] || 0,
          publishedAt: survey.publishedAt || null,
        };
      }),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to list survey lifecycle.');
  }
};

const updateSurveyLifecycle = async (req, res) => {
  try {
    const id = asTrimmed(req.params.id);
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Survey identifier is invalid.' });
    const survey = await Survey.findById(id);
    if (!survey) return res.status(404).json({ message: 'Survey not found.' });

    const action = toLower(req.body?.action);
    if (action === 'publish') {
      survey.publishStatus = 'published';
      survey.isActive = true;
      survey.publishedAt = new Date();
    } else if (action === 'unpublish') {
      survey.publishStatus = 'unpublished';
      survey.isActive = false;
      survey.unpublishedAt = new Date();
    } else if (action === 'close') {
      survey.publishStatus = 'closed';
      survey.isActive = false;
    }

    if (req.body?.deadlineAt !== undefined) survey.deadlineAt = req.body.deadlineAt ? new Date(req.body.deadlineAt) : null;
    if (req.body?.autoCloseAtDeadline !== undefined) survey.autoCloseAtDeadline = req.body.autoCloseAtDeadline === true;
    if (req.body?.previewEnabled !== undefined) survey.previewEnabled = req.body.previewEnabled === true;
    if (Array.isArray(req.body?.targetGrades)) survey.targetGrades = req.body.targetGrades;
    if (Array.isArray(req.body?.targetClasses)) survey.targetClasses = req.body.targetClasses;

    await survey.save();
    return res.json({ success: true });
  } catch (error) {
    return sendServerError(res, error, 'Failed to update survey lifecycle.');
  }
};

const exportSurveyRawData = async (req, res) => {
  try {
    const surveyId = asTrimmed(req.params.id);
    if (!isValidObjectId(surveyId)) return res.status(400).json({ message: 'Survey identifier is invalid.' });
    const survey = await Survey.findById(surveyId).lean();
    if (!survey) return res.status(404).json({ message: 'Survey not found.' });
    const responses = await SurveyResponse.find({ surveyId }, { respondentId: 1, respondentRole: 1, answers: 1, createdAt: 1 }).lean();
    const csv = toCsv(
      ['surveyTitle', 'respondentId', 'respondentRole', 'questionId', 'selectedOptions', 'textAnswer', 'ratingValue', 'submittedAt'],
      responses.flatMap((response) =>
        (response.answers || []).map((answer) => [
          survey.title || '',
          String(response.respondentId || ''),
          response.respondentRole || '',
          answer.questionId || '',
          (answer.selectedOptions || []).join('|'),
          answer.textAnswer || '',
          answer.ratingValue ?? '',
          response.createdAt || '',
        ])
      )
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"survey-raw-${surveyId}.csv\"`);
    return res.send(csv);
  } catch (error) {
    return sendServerError(res, error, 'Failed to export survey raw data.');
  }
};

const getObservabilitySnapshot = async (_req, res) => {
  try {
    const [students, teachers, classes, scheduleEntries, attendanceRecords, incidents, feedbacks, notifications] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'teacher' }),
      ClassModel.countDocuments({}),
      ScheduleEntry.countDocuments({ isActive: true }),
      AttendanceRecord.countDocuments({}),
      Incident.countDocuments({}),
      Feedback.countDocuments({}),
      Notification.countDocuments({}),
    ]);

    return res.json({
      generatedAt: new Date().toISOString(),
      entities: { students, teachers, classes, scheduleEntries, attendanceRecords, incidents, feedbacks, notifications },
      health: {
        workload: scheduleEntries > 5000 ? 'high' : scheduleEntries > 1000 ? 'medium' : 'low',
        recommendation: scheduleEntries > 5000 ? 'Increase indexing and background processing.' : 'Current load is within expected range.',
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load observability snapshot.');
  }
};

module.exports = {
  getEnterpriseHierarchy,
  getEnterpriseDashboard,
  listEnterpriseStudents,
  bulkUpdateEnterpriseStudents,
  exportEnterpriseStudents,
  listEnterpriseTeachers,
  listEnterpriseClasses,
  getEnterpriseStudentDetail,
  getEnterpriseTeacherDetail,
  getEnterpriseClassDetail,
  updateEnterpriseClassDetail,
  exportClassRoster,
  listSavedViews,
  createSavedView,
  deleteSavedView,
  getSystemContext,
  updateSystemContext,
  getPermissionMatrix,
  updatePermissionMatrix,
  listNotificationWorkflow,
  updateNotificationWorkflow,
  listTicketWorkflow,
  updateTicketWorkflow,
  exportTicketWorkflow,
  listSurveyLifecycle,
  updateSurveyLifecycle,
  exportSurveyRawData,
  getObservabilitySnapshot,
};
