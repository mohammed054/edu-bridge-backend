const AttendanceRecord = require('../models/AttendanceRecord');
const Incident = require('../models/Incident');
const User = require('../models/User');

const DAY_MS = 24 * 60 * 60 * 1000;

const asId = (value) => String(value || '');

const toLower = (value) => String(value || '').trim().toLowerCase();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

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

const buildStudentIntelligenceProfiles = ({ students, attendanceByStudent, incidentsByStudent, engagementByStudent }) => {
  const profiles = students.map((student) => {
    const studentId = asId(student._id);
    const attendance = attendanceByStudent[studentId] || createAttendanceBucket();
    const incidents = incidentsByStudent[studentId] || createIncidentBucket();
    const engagement = engagementByStudent[studentId] || createEngagementBucket();
    const pendingHomeworkCount = (student.homework || []).filter((item) => item.status === 'pending').length;

    const risk = buildRiskProfile({
      attendance,
      incidents,
      engagement,
      pendingHomeworkCount,
    });

    return {
      studentId,
      studentName: student.name || '',
      className: (student.classes || [])[0] || '',
      riskIndex: risk.riskIndex,
      contributingFactors: risk.contributingFactors,
      ruleBasedNudges: risk.nudges,
      attendance,
      incidents,
      parentEngagement: engagement,
      pendingHomeworkCount,
      weeklySummary: `${student.name || 'Student'}: ${risk.riskIndex} risk (${risk.contributingFactors.join(', ')}).`,
    };
  });

  const sortWeight = { High: 0, Medium: 1, Low: 2 };

  return profiles.sort((left, right) => {
    const weightDiff = (sortWeight[left.riskIndex] || 9) - (sortWeight[right.riskIndex] || 9);
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return (right.incidents.total || 0) - (left.incidents.total || 0);
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

const buildTeacherDashboardInsights = async (teacherId) => {
  const teacher = await User.findOne({ _id: teacherId, role: 'teacher' }, { classes: 1 }).lean();
  if (!teacher) {
    return {
      generatedAt: new Date().toISOString(),
      pendingResponses: 0,
      flaggedParents: 0,
      repeatedIncidents: 0,
      riskIndex: { Low: 0, Medium: 0, High: 0 },
      parentEngagementScores: [],
      studentsAtRisk: [],
      weeklySummary: [],
    };
  }

  const classNames = teacher.classes || [];
  if (!classNames.length) {
    return {
      generatedAt: new Date().toISOString(),
      pendingResponses: 0,
      flaggedParents: 0,
      repeatedIncidents: 0,
      riskIndex: { Low: 0, Medium: 0, High: 0 },
      parentEngagementScores: [],
      studentsAtRisk: [],
      weeklySummary: [],
    };
  }

  const sinceDate = new Date(Date.now() - 30 * DAY_MS);

  const [students, attendanceRecords, incidents] = await Promise.all([
    User.find(
      { role: 'student', classes: { $in: classNames } },
      { name: 1, classes: 1, homework: 1 }
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
    weeklySummary: riskStudents.slice(0, 6).map((item) => {
      const reason = item.contributingFactors[0] || 'No critical factor identified';
      return `${item.studentName}: ${item.riskLevel} risk (${reason}).`;
    }),
  };
};

const buildAdminIntelligenceOverview = async () => {
  const sinceDate = new Date(Date.now() - 30 * DAY_MS);

  const [students, attendanceRecords, incidents] = await Promise.all([
    User.find({ role: 'student' }, { name: 1, classes: 1, homework: 1 }).lean(),
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

  return {
    generatedAt: new Date().toISOString(),
    ...common,
    studentsAtRisk: riskStudents,
    weeklySummary: riskStudents.slice(0, 10).map((item) => {
      const reason = item.contributingFactors[0] || 'No critical factor identified';
      return `${item.studentName}: ${item.riskLevel} risk (${reason}).`;
    }),
  };
};

module.exports = {
  buildAdminIntelligenceOverview,
  buildTeacherDashboardInsights,
};
