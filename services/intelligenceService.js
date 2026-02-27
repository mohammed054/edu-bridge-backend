const AttendanceRecord = require('../models/AttendanceRecord');
const Incident = require('../models/Incident');
const User = require('../models/User');

const DAY_MS = 24 * 60 * 60 * 1000;

const asId = (value) => String(value || '');

const asTrimmed = (value) => String(value || '').trim();

const toLower = (value) => asTrimmed(value).toLowerCase();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

const safeDateValue = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const createAttendanceBucket = () => ({
  present: 0,
  absent: 0,
  late: 0,
  total: 0,
  attendancePercentage: 0,
});

const createIncidentBucket = () => ({
  low: 0,
  medium: 0,
  high: 0,
  total: 0,
});

const createEngagementBucket = () => ({
  totalNotifications: 0,
  readCount: 0,
  respondedCount: 0,
  avgResponseHours: null,
  readRate: 0,
  responseRate: 0,
  frequencyLast30Days: 0,
  level: 'Medium',
});

const createEmptySignals = () => ({
  studentId: '',
  studentName: '',
  className: '',
  riskIndex: 'Low',
  contributingFactors: ['No critical factor identified'],
  ruleBasedNudges: ['Maintain current intervention and review next week.'],
  attendance: createAttendanceBucket(),
  incidents: createIncidentBucket(),
  parentEngagement: createEngagementBucket(),
  pendingHomeworkCount: 0,
  academicDirection: 'Stable',
  grades: {
    latestPercentage: null,
    previousPercentage: null,
    deltaPercentage: null,
    sampleCount: 0,
  },
  trendShifts: [],
  attendancePattern: 'No attendance data yet.',
  behaviorNote: 'No behavior incidents logged in the selected period.',
  parentEngagementStatus: 'Medium',
  riskStatus: 'Low',
  advisoryNote: 'Risk indicators are advisory only and require teacher review.',
  weeklySummary:
    'Student: advisory low risk. Human review is required before any intervention decision.',
  weeklySnapshot: {
    studentId: '',
    studentName: '',
    className: '',
    academicDirection: 'Stable',
    attendancePattern: 'No attendance data yet.',
    behaviorNote: 'No behavior incidents logged in the selected period.',
    parentEngagementStatus: 'Medium',
    riskStatus: 'Low',
    advisoryNote: 'Risk indicators are advisory only and require teacher review.',
  },
});

const levelFromEngagementScore = (score) => {
  if (score >= 2) {
    return 'High';
  }

  if (score <= -1) {
    return 'Low';
  }

  return 'Medium';
};

const levelFromRiskScore = (score) => {
  if (score >= 4) {
    return 'High';
  }

  if (score >= 2) {
    return 'Medium';
  }

  return 'Low';
};

const scoreFromExamMark = (mark) => {
  const rawScore = mark?.rawScore === null || mark?.rawScore === undefined
    ? Number(mark?.score)
    : Number(mark.rawScore);

  const maxMarks = Number(mark?.maxMarks || 100) || 100;
  if (Number.isNaN(rawScore) || Number.isNaN(maxMarks) || maxMarks <= 0) {
    if (Number.isNaN(Number(mark?.score))) {
      return null;
    }
    return clamp(Number(mark.score || 0), 0, 100);
  }

  return round(clamp((rawScore / maxMarks) * 100, 0, 100), 2);
};

const buildAttendanceByStudent = (records = []) => {
  const map = {};

  records.forEach((record) => {
    (record.entries || []).forEach((entry) => {
      const studentId = asId(entry.studentId);
      if (!studentId) {
        return;
      }

      if (!map[studentId]) {
        map[studentId] = createAttendanceBucket();
      }

      const status = toLower(entry.status);
      if (status === 'present') {
        map[studentId].present += 1;
      } else if (status === 'absent') {
        map[studentId].absent += 1;
      } else if (status === 'late') {
        map[studentId].late += 1;
      }

      map[studentId].total += 1;
    });
  });

  Object.values(map).forEach((item) => {
    const weightedPresent = item.present + item.late * 0.5;
    item.attendancePercentage = item.total
      ? round(clamp((weightedPresent / item.total) * 100, 0, 100))
      : 0;
  });

  return map;
};

const buildIncidentsByStudent = (incidents = []) => {
  const map = {};

  incidents.forEach((incident) => {
    const studentId = asId(incident.studentId);
    if (!studentId) {
      return;
    }

    if (!map[studentId]) {
      map[studentId] = createIncidentBucket();
    }

    const severity = toLower(incident.severity);
    if (severity === 'low') {
      map[studentId].low += 1;
    } else if (severity === 'medium') {
      map[studentId].medium += 1;
    } else if (severity === 'high') {
      map[studentId].high += 1;
    }

    map[studentId].total += 1;
  });

  return map;
};

const buildParentEngagementByStudent = (incidents = []) => {
  const now = Date.now();
  const last30DaysStart = now - 30 * DAY_MS;
  const map = {};

  incidents.forEach((incident) => {
    const studentId = asId(incident.studentId);
    if (!studentId) {
      return;
    }

    if (!map[studentId]) {
      map[studentId] = {
        ...createEngagementBucket(),
        totalResponseHours: 0,
        responseSamples: 0,
      };
    }

    const bucket = map[studentId];
    const notification = incident.parentNotification || {};

    if (notification.sentAt) {
      bucket.totalNotifications += 1;
    }

    const status = toLower(notification.status);
    const hasRead = status === 'read' || status === 'responded' || Boolean(notification.readAt);
    const hasResponded = status === 'responded' || Boolean(notification.respondedAt);

    if (hasRead) {
      bucket.readCount += 1;
    }

    if (hasResponded) {
      bucket.respondedCount += 1;
    }

    if (notification.sentAt && notification.respondedAt) {
      const sentAt = new Date(notification.sentAt).getTime();
      const respondedAt = new Date(notification.respondedAt).getTime();
      if (!Number.isNaN(sentAt) && !Number.isNaN(respondedAt) && respondedAt >= sentAt) {
        bucket.totalResponseHours += (respondedAt - sentAt) / (60 * 60 * 1000);
        bucket.responseSamples += 1;
      }
    }

    const createdAt = new Date(incident.createdAt).getTime();
    if (!Number.isNaN(createdAt) && createdAt >= last30DaysStart) {
      bucket.frequencyLast30Days += 1;
    }
  });

  Object.values(map).forEach((bucket) => {
    const denominator = Math.max(1, bucket.totalNotifications);

    bucket.readRate = round(bucket.readCount / denominator);
    bucket.responseRate = round(bucket.respondedCount / denominator);
    bucket.avgResponseHours = bucket.responseSamples
      ? round(bucket.totalResponseHours / bucket.responseSamples)
      : null;

    let score = 0;
    if (bucket.readRate >= 0.7) {
      score += 1;
    } else if (bucket.readRate < 0.4) {
      score -= 1;
    }

    if (bucket.responseRate >= 0.6) {
      score += 1;
    } else if (bucket.responseRate < 0.3) {
      score -= 1;
    }

    if (bucket.avgResponseHours !== null) {
      if (bucket.avgResponseHours <= 24) {
        score += 1;
      } else if (bucket.avgResponseHours > 72) {
        score -= 1;
      }
    }

    if (bucket.frequencyLast30Days >= 4) {
      score -= 1;
    }

    bucket.level = levelFromEngagementScore(score);
    delete bucket.totalResponseHours;
    delete bucket.responseSamples;
  });

  return map;
};

const buildRuleBasedNudges = ({ attendance, incidents, engagement, pendingHomeworkCount }) => {
  const nudges = [];

  if ((incidents.high || 0) > 0) {
    nudges.push('Arrange a parent meeting within 48 hours.');
  }

  if ((incidents.medium || 0) >= 2 || (incidents.low || 0) >= 3) {
    nudges.push('Start a behavior follow-up plan with weekly check-ins.');
  }

  if ((attendance.absent || 0) >= 2 || (attendance.late || 0) >= 3) {
    nudges.push('Initiate daily attendance check-in at first period.');
  }

  if (engagement.level === 'Low') {
    nudges.push('Follow up parent notifications by phone within 24 hours.');
  }

  if (pendingHomeworkCount >= 2) {
    nudges.push('Coordinate assignment recovery support with the student.');
  }

  if (!nudges.length) {
    nudges.push('Maintain current intervention and review next week.');
  }

  return nudges;
};

const buildContributingFactors = ({ attendance, incidents, engagement, pendingHomeworkCount }) => {
  const factors = [];

  if ((incidents.high || 0) >= 1) {
    factors.push('High-severity behavior incident');
  } else if ((incidents.medium || 0) >= 2 || (incidents.low || 0) >= 3) {
    factors.push('Repeated behavior incidents');
  }

  if ((attendance.absent || 0) >= 2 || (attendance.late || 0) >= 3) {
    factors.push('Attendance concerns');
  }

  if (engagement.level === 'Low') {
    factors.push('Low parent engagement');
  }

  if (pendingHomeworkCount >= 2) {
    factors.push('Missing homework pattern');
  }

  if (!factors.length) {
    factors.push('No critical factor identified');
  }

  return factors;
};

const buildRiskProfile = ({ attendance, incidents, engagement, pendingHomeworkCount }) => {
  let score = 0;

  if ((attendance.absent || 0) >= 2) {
    score += 1;
  }

  if ((attendance.late || 0) >= 3) {
    score += 1;
  }

  if ((incidents.high || 0) >= 1) {
    score += 2;
  }

  if ((incidents.medium || 0) >= 2) {
    score += 1;
  }

  if ((incidents.low || 0) >= 3) {
    score += 1;
  }

  if (engagement.level === 'Low') {
    score += 1;
  }

  if (pendingHomeworkCount >= 2) {
    score += 1;
  }

  return {
    riskIndex: levelFromRiskScore(score),
    contributingFactors: buildContributingFactors({
      attendance,
      incidents,
      engagement,
      pendingHomeworkCount,
    }),
    nudges: buildRuleBasedNudges({ attendance, incidents, engagement, pendingHomeworkCount }),
  };
};

const buildAcademicTrend = (examMarks = [], subjectFilter = '') => {
  const filtered = (examMarks || [])
    .filter((mark) => {
      if (!subjectFilter) {
        return true;
      }
      return toLower(mark.subject) === toLower(subjectFilter);
    })
    .map((mark) => ({
      ...mark,
      percentage: scoreFromExamMark(mark),
      updatedAtValue: safeDateValue(mark.updatedAt),
    }))
    .filter((mark) => mark.percentage !== null)
    .sort((left, right) => right.updatedAtValue - left.updatedAtValue);

  const latest = filtered[0] || null;
  const previous = filtered[1] || null;

  if (!latest || !previous) {
    return {
      direction: 'Stable',
      latestPercentage: latest ? round(latest.percentage) : null,
      previousPercentage: previous ? round(previous.percentage) : null,
      deltaPercentage: null,
      sampleCount: filtered.length,
      trendShifts: filtered.length ? ['Limited grade history.'] : ['No grade data available.'],
    };
  }

  const delta = round(latest.percentage - previous.percentage);
  const direction = delta >= 5 ? 'Improving' : delta <= -5 ? 'Declining' : 'Stable';

  const trendShifts = [];
  if (direction === 'Improving') {
    trendShifts.push(`Latest exam improved by ${Math.abs(delta)} points.`);
  } else if (direction === 'Declining') {
    trendShifts.push(`Latest exam dropped by ${Math.abs(delta)} points.`);
  } else {
    trendShifts.push('Recent exam trend is stable.');
  }

  return {
    direction,
    latestPercentage: round(latest.percentage),
    previousPercentage: round(previous.percentage),
    deltaPercentage: delta,
    sampleCount: filtered.length,
    trendShifts,
  };
};

const attendancePatternFromBucket = (attendance = createAttendanceBucket()) => {
  if (!attendance.total) {
    return 'No attendance data yet.';
  }

  if ((attendance.absent || 0) >= 2 || (attendance.late || 0) >= 3) {
    return 'Irregular attendance trend this week.';
  }

  if ((attendance.attendancePercentage || 0) >= 95) {
    return 'Consistent attendance pattern.';
  }

  if ((attendance.attendancePercentage || 0) >= 85) {
    return 'Mostly stable attendance with minor gaps.';
  }

  return 'Attendance gaps are affecting weekly continuity.';
};

const behaviorNoteFromBucket = (incidents = createIncidentBucket()) => {
  if ((incidents.high || 0) > 0) {
    return 'High-severity behavior incident logged recently.';
  }

  if ((incidents.medium || 0) >= 2) {
    return 'Repeated medium-severity behavior incidents observed.';
  }

  if ((incidents.low || 0) >= 2) {
    return 'Low-severity behavior pattern needs follow-up.';
  }

  return 'No behavior incidents logged in the selected period.';
};

const advisoryNoteFromSignals = ({ riskIndex, direction, attendancePattern }) => {
  if (riskIndex === 'High') {
    return `Advisory: ${direction} academic direction with elevated support need. Teacher review required.`;
  }

  if (riskIndex === 'Medium') {
    return `Advisory: ${direction} direction with monitored risk. ${attendancePattern}`;
  }

  return 'Advisory: low current risk. Continue regular monitoring.';
};

const buildWeeklySnapshot = (signals) => ({
  studentId: signals.studentId,
  studentName: signals.studentName,
  className: signals.className,
  academicDirection: signals.academicDirection,
  attendancePattern: signals.attendancePattern,
  behaviorNote: signals.behaviorNote,
  parentEngagementStatus: signals.parentEngagementStatus,
  riskStatus: signals.riskStatus,
  advisoryNote: signals.advisoryNote,
});

const buildStudentSignals = ({
  student,
  attendance,
  incidents,
  engagement,
  subjectFilter = '',
}) => {
  const base = createEmptySignals();
  if (!student) {
    return base;
  }

  const pendingHomeworkCount = (student.homework || []).filter((item) => item.status === 'pending').length;

  const risk = buildRiskProfile({
    attendance,
    incidents,
    engagement,
    pendingHomeworkCount,
  });

  const academic = buildAcademicTrend(student.examMarks || [], subjectFilter);
  const attendancePattern = attendancePatternFromBucket(attendance);
  const behaviorNote = behaviorNoteFromBucket(incidents);
  const parentEngagementStatus = engagement.level || 'Medium';
  const riskStatus = risk.riskIndex;
  const advisoryNote = advisoryNoteFromSignals({
    riskIndex: riskStatus,
    direction: academic.direction,
    attendancePattern,
  });

  const signals = {
    studentId: asId(student._id),
    studentName: student.name || '',
    className: (student.classes || [])[0] || '',
    riskIndex: riskStatus,
    contributingFactors: risk.contributingFactors,
    ruleBasedNudges: risk.nudges,
    attendance,
    incidents,
    parentEngagement: engagement,
    pendingHomeworkCount,
    academicDirection: academic.direction,
    grades: {
      latestPercentage: academic.latestPercentage,
      previousPercentage: academic.previousPercentage,
      deltaPercentage: academic.deltaPercentage,
      sampleCount: academic.sampleCount,
    },
    trendShifts: academic.trendShifts,
    attendancePattern,
    behaviorNote,
    parentEngagementStatus,
    riskStatus,
    advisoryNote,
    weeklySummary: `${student.name || 'Student'}: ${riskStatus} risk, ${academic.direction} academics, ${attendancePattern}`,
  };

  return {
    ...signals,
    weeklySnapshot: buildWeeklySnapshot(signals),
  };
};

const buildStudentIntelligenceProfiles = ({
  students,
  attendanceByStudent,
  incidentsByStudent,
  engagementByStudent,
}) => {
  const profiles = students.map((student) => {
    const studentId = asId(student._id);
    const attendance = attendanceByStudent[studentId] || createAttendanceBucket();
    const incidents = incidentsByStudent[studentId] || createIncidentBucket();
    const engagement = engagementByStudent[studentId] || createEngagementBucket();

    return buildStudentSignals({
      student,
      attendance,
      incidents,
      engagement,
    });
  });

  const sortWeight = { High: 0, Medium: 1, Low: 2 };

  return profiles.sort((left, right) => {
    const weightDiff = (sortWeight[left.riskIndex] || 9) - (sortWeight[right.riskIndex] || 9);
    if (weightDiff !== 0) {
      return weightDiff;
    }

    if (right.incidents.total !== left.incidents.total) {
      return (right.incidents.total || 0) - (left.incidents.total || 0);
    }

    return (right.attendance.absent || 0) - (left.attendance.absent || 0);
  });
};

const aggregateRiskCounts = (profiles = []) =>
  profiles.reduce(
    (acc, profile) => {
      if (profile.riskIndex === 'High') {
        acc.high += 1;
      } else if (profile.riskIndex === 'Medium') {
        acc.medium += 1;
      } else {
        acc.low += 1;
      }
      return acc;
    },
    { low: 0, medium: 0, high: 0 }
  );

const buildCommonOverview = ({ profiles, incidentsLast30Days }) => {
  const riskCounts = aggregateRiskCounts(profiles);

  const pendingResponses = incidentsLast30Days.filter(
    (item) => toLower(item.parentNotification?.status) !== 'responded'
  ).length;

  const repeatedIncidents = Object.values(
    incidentsLast30Days.reduce((acc, incident) => {
      const studentId = asId(incident.studentId);
      if (!studentId) {
        return acc;
      }

      acc[studentId] = Number(acc[studentId] || 0) + 1;
      return acc;
    }, {})
  ).filter((count) => count >= 2).length;

  const flaggedParents = profiles.filter((item) => item.parentEngagement.level === 'Low').length;

  return {
    riskIndex: {
      Low: riskCounts.low,
      Medium: riskCounts.medium,
      High: riskCounts.high,
    },
    pendingResponses,
    flaggedParents,
    repeatedIncidents,
  };
};

const summarizeExamGroupsByClass = (students = [], classScope = null) => {
  const grouped = {};

  students.forEach((student) => {
    const className = (student.classes || [])[0] || '';
    if (!className) {
      return;
    }

    if (classScope && !classScope.has(className)) {
      return;
    }

    (student.examMarks || []).forEach((mark) => {
      const subject = asTrimmed(mark.subject) || 'General';
      const examTitle = asTrimmed(mark.examTitle) || 'Assessment';
      const percentage = scoreFromExamMark(mark);
      if (percentage === null) {
        return;
      }

      const key = `${className}::${subject}::${examTitle}`;
      if (!grouped[key]) {
        grouped[key] = {
          className,
          subject,
          examTitle,
          samples: [],
          lastUpdatedAtValue: 0,
        };
      }

      grouped[key].samples.push({
        studentId: asId(student._id),
        studentName: student.name || '',
        percentage,
      });
      grouped[key].lastUpdatedAtValue = Math.max(
        grouped[key].lastUpdatedAtValue,
        safeDateValue(mark.updatedAt)
      );
    });
  });

  const byClassAndSubject = {};

  Object.values(grouped).forEach((entry) => {
    const key = `${entry.className}::${entry.subject}`;
    if (!byClassAndSubject[key]) {
      byClassAndSubject[key] = {
        className: entry.className,
        subject: entry.subject,
        exams: [],
      };
    }

    const scores = entry.samples.map((sample) => sample.percentage);
    const average = scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : 0;
    const variance = scores.length
      ? scores.reduce((sum, value) => sum + (value - average) ** 2, 0) / scores.length
      : 0;

    byClassAndSubject[key].exams.push({
      examTitle: entry.examTitle,
      count: scores.length,
      average: round(average),
      stdDev: round(Math.sqrt(variance)),
      samples: entry.samples,
      lastUpdatedAtValue: entry.lastUpdatedAtValue,
    });
  });

  Object.values(byClassAndSubject).forEach((entry) => {
    entry.exams.sort((left, right) => left.lastUpdatedAtValue - right.lastUpdatedAtValue);
  });

  return Object.values(byClassAndSubject);
};

const buildRapidDeclineSignals = (students = [], classScope = null) => {
  const events = [];

  students.forEach((student) => {
    const className = (student.classes || [])[0] || '';
    if (!className) {
      return;
    }

    if (classScope && !classScope.has(className)) {
      return;
    }

    const bySubject = {};
    (student.examMarks || []).forEach((mark) => {
      const subject = asTrimmed(mark.subject) || 'General';
      if (!bySubject[subject]) {
        bySubject[subject] = [];
      }
      const percentage = scoreFromExamMark(mark);
      if (percentage === null) {
        return;
      }

      bySubject[subject].push({
        examTitle: asTrimmed(mark.examTitle) || 'Assessment',
        percentage,
        updatedAtValue: safeDateValue(mark.updatedAt),
      });
    });

    Object.entries(bySubject).forEach(([subject, marks]) => {
      if (marks.length < 2) {
        return;
      }

      const sorted = [...marks].sort((left, right) => right.updatedAtValue - left.updatedAtValue);
      const latest = sorted[0];
      const previous = sorted[1];
      const delta = round(latest.percentage - previous.percentage);

      if (delta <= -20) {
        events.push({
          className,
          subject,
          studentName: student.name || '',
          examTitle: latest.examTitle,
          previousExamTitle: previous.examTitle,
          drop: Math.abs(delta),
        });
      }
    });
  });

  return events;
};

const buildClassAnalysisSuggestions = (students = [], classScope = null) => {
  const suggestions = [];

  const classExamGroups = summarizeExamGroupsByClass(students, classScope);

  classExamGroups.forEach((group) => {
    const exams = group.exams || [];

    for (let index = 1; index < exams.length; index += 1) {
      const previous = exams[index - 1];
      const current = exams[index];
      if (previous.count < 3 || current.count < 3 || previous.average <= 0) {
        continue;
      }

      const drop = previous.average - current.average;
      const dropPercentage = (drop / previous.average) * 100;

      if (dropPercentage >= 15) {
        suggestions.push({
          type: 'exam_anomaly',
          className: group.className,
          subject: group.subject,
          message: `${group.subject} ${current.examTitle} shows a ${round(
            dropPercentage,
            1
          )}% average drop compared to ${previous.examTitle}.`,
          suggestion:
            'Review item difficulty and coverage alignment, then reteach the highest-missed standards before the next assessment.',
        });
      }
    }

    const latestExam = exams[exams.length - 1];
    if (latestExam && latestExam.count >= 5) {
      const threshold = Math.max(10, latestExam.stdDev * 1.5);
      const highCutoff = latestExam.average + threshold;
      const lowCutoff = latestExam.average - threshold;

      latestExam.samples
        .filter((sample) => sample.percentage >= highCutoff || sample.percentage <= lowCutoff)
        .slice(0, 3)
        .forEach((sample) => {
          const direction = sample.percentage >= highCutoff ? 'above' : 'below';
          suggestions.push({
            type: 'outlier_performance',
            className: group.className,
            subject: group.subject,
            message: `${sample.studentName} is an outlier in ${group.subject} ${latestExam.examTitle} (${round(
              sample.percentage,
              1
            )}% ${direction} class trend).`,
            suggestion:
              direction === 'below'
                ? 'Consider a targeted support plan and check conceptual gaps in the latest unit.'
                : 'Consider enrichment tasks to sustain advanced progress.',
          });
        });
    }
  });

  buildRapidDeclineSignals(students, classScope).slice(0, 8).forEach((event) => {
    suggestions.push({
      type: 'rapid_decline',
      className: event.className,
      subject: event.subject,
      message: `${event.studentName} dropped ${round(event.drop, 1)} points in ${event.subject} from ${event.previousExamTitle} to ${event.examTitle}.`,
      suggestion:
        'Schedule a short diagnostic review and coordinate follow-up support in the next instructional cycle.',
    });
  });

  const severity = {
    exam_anomaly: 0,
    rapid_decline: 1,
    outlier_performance: 2,
  };

  return suggestions
    .sort((left, right) => {
      const severityDiff = (severity[left.type] || 9) - (severity[right.type] || 9);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      return String(left.className || '').localeCompare(String(right.className || ''));
    })
    .slice(0, 20);
};

const buildEmptyDashboardPayload = () => ({
  generatedAt: new Date().toISOString(),
  pendingResponses: 0,
  flaggedParents: 0,
  repeatedIncidents: 0,
  riskIndex: { Low: 0, Medium: 0, High: 0 },
  parentEngagementScores: [],
  studentsAtRisk: [],
  weeklySummary: [],
  weeklySnapshots: [],
  classAnalysis: [],
});

const buildTeacherDashboardInsights = async (teacherId) => {
  const teacher = await User.findOne(
    { _id: teacherId, role: 'teacher' },
    { classes: 1, subject: 1, subjects: 1 }
  ).lean();
  if (!teacher) {
    return buildEmptyDashboardPayload();
  }

  const classNames = teacher.classes || [];
  if (!classNames.length) {
    return buildEmptyDashboardPayload();
  }

  const sinceDate = new Date(Date.now() - 30 * DAY_MS);

  const [studentsRaw, attendanceRecords, incidents] = await Promise.all([
    User.find(
      { role: 'student', classes: { $in: classNames } },
      { name: 1, classes: 1, homework: 1, examMarks: 1 }
    ).lean(),
    AttendanceRecord.find(
      { className: { $in: classNames }, attendanceDate: { $gte: sinceDate } },
      { entries: 1 }
    ).lean(),
    Incident.find(
      { teacherId, className: { $in: classNames }, createdAt: { $gte: sinceDate } },
      { studentId: 1, parentNotification: 1, severity: 1, createdAt: 1 }
    ).lean(),
  ]);

  const attendanceByStudent = buildAttendanceByStudent(attendanceRecords);
  const incidentsByStudent = buildIncidentsByStudent(incidents);
  const engagementByStudent = buildParentEngagementByStudent(incidents);

  const subjectScope = new Set((teacher.subjects || [teacher.subject]).filter(Boolean).map(toLower));
  const students = studentsRaw.map((student) => ({
    ...student,
    examMarks: subjectScope.size
      ? (student.examMarks || []).filter((mark) => subjectScope.has(toLower(mark.subject)))
      : student.examMarks || [],
  }));

  const profiles = buildStudentIntelligenceProfiles({
    students,
    attendanceByStudent,
    incidentsByStudent,
    engagementByStudent,
  });

  const common = buildCommonOverview({ profiles, incidentsLast30Days: incidents });
  const riskStudents = profiles
    .filter((item) => item.riskIndex !== 'Low')
    .map((item) => ({
      studentId: item.studentId,
      studentName: item.studentName,
      className: item.className,
      riskLevel: item.riskIndex,
      contributingFactors: item.contributingFactors,
      ruleBasedNudges: item.ruleBasedNudges,
    }));

  const weeklySnapshots = profiles.map((item) => item.weeklySnapshot);

  return {
    generatedAt: new Date().toISOString(),
    pendingResponses: common.pendingResponses,
    flaggedParents: common.flaggedParents,
    repeatedIncidents: common.repeatedIncidents,
    riskIndex: common.riskIndex,
    parentEngagementScores: profiles.map((item) => ({
      studentId: item.studentId,
      studentName: item.studentName,
      className: item.className,
      level: item.parentEngagement.level,
    })),
    studentsAtRisk: riskStudents,
    weeklySnapshots,
    classAnalysis: buildClassAnalysisSuggestions(students, new Set(classNames)),
    weeklySummary: weeklySnapshots.slice(0, 6).map(
      (item) => `${item.studentName}: ${item.riskStatus} risk, ${item.academicDirection}, ${item.attendancePattern}`
    ),
  };
};

const buildAdminIntelligenceOverview = async () => {
  const sinceDate = new Date(Date.now() - 30 * DAY_MS);

  const [students, attendanceRecords, incidents] = await Promise.all([
    User.find({ role: 'student' }, { name: 1, classes: 1, homework: 1, examMarks: 1 }).lean(),
    AttendanceRecord.find({ attendanceDate: { $gte: sinceDate } }, { entries: 1 }).lean(),
    Incident.find(
      { createdAt: { $gte: sinceDate } },
      { studentId: 1, parentNotification: 1, severity: 1, createdAt: 1 }
    ).lean(),
  ]);

  const attendanceByStudent = buildAttendanceByStudent(attendanceRecords);
  const incidentsByStudent = buildIncidentsByStudent(incidents);
  const engagementByStudent = buildParentEngagementByStudent(incidents);

  const profiles = buildStudentIntelligenceProfiles({
    students,
    attendanceByStudent,
    incidentsByStudent,
    engagementByStudent,
  });

  const common = buildCommonOverview({ profiles, incidentsLast30Days: incidents });
  const riskStudents = profiles
    .filter((item) => item.riskIndex !== 'Low')
    .map((item) => ({
      studentId: item.studentId,
      studentName: item.studentName,
      className: item.className,
      riskLevel: item.riskIndex,
      contributingFactors: item.contributingFactors,
      ruleBasedNudges: item.ruleBasedNudges,
    }));

  const weeklySnapshots = profiles.map((item) => item.weeklySnapshot);

  return {
    generatedAt: new Date().toISOString(),
    ...common,
    studentsAtRisk: riskStudents,
    weeklySnapshots,
    classAnalysis: buildClassAnalysisSuggestions(students, null),
    weeklySummary: weeklySnapshots.slice(0, 10).map(
      (item) => `${item.studentName}: ${item.riskStatus} risk, ${item.academicDirection}, ${item.attendancePattern}`
    ),
  };
};

const buildStudentAiSignals = async (studentId, { subject = '' } = {}) => {
  const student = await User.findOne(
    { _id: studentId, role: 'student' },
    { name: 1, classes: 1, homework: 1, examMarks: 1 }
  ).lean();

  if (!student) {
    return createEmptySignals();
  }

  const className = (student.classes || [])[0] || '';
  const sinceDate = new Date(Date.now() - 30 * DAY_MS);

  const [attendanceRecords, incidents] = await Promise.all([
    className
      ? AttendanceRecord.find(
          {
            className,
            attendanceDate: { $gte: sinceDate },
          },
          { entries: 1 }
        ).lean()
      : [],
    Incident.find(
      {
        studentId,
        createdAt: { $gte: sinceDate },
      },
      { studentId: 1, parentNotification: 1, severity: 1, createdAt: 1 }
    ).lean(),
  ]);

  const attendanceByStudent = buildAttendanceByStudent(attendanceRecords);
  const incidentsByStudent = buildIncidentsByStudent(incidents);
  const engagementByStudent = buildParentEngagementByStudent(incidents);

  return buildStudentSignals({
    student,
    attendance: attendanceByStudent[asId(student._id)] || createAttendanceBucket(),
    incidents: incidentsByStudent[asId(student._id)] || createIncidentBucket(),
    engagement: engagementByStudent[asId(student._id)] || createEngagementBucket(),
    subjectFilter: subject,
  });
};

const buildStudentWeeklySnapshot = async (studentId, { subject = '' } = {}) => {
  const signals = await buildStudentAiSignals(studentId, { subject });
  return signals.weeklySnapshot || createEmptySignals().weeklySnapshot;
};

module.exports = {
  buildAdminIntelligenceOverview,
  buildTeacherDashboardInsights,
  buildStudentWeeklySnapshot,
  buildStudentAiSignals,
  buildClassAnalysisSuggestions,
};
