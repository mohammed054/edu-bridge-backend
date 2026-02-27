const Incident = require('../models/Incident');
const User = require('../models/User');

const asTrimmed = (value) => String(value || '').trim();

const hasSubjectAccess = (teacherSubjects, subject) =>
  (teacherSubjects || []).some(
    (entry) => String(entry || '').toLowerCase() === String(subject || '').toLowerCase()
  );

const mapIncident = (incident) => ({
  id: String(incident._id),
  studentId: String(incident.studentId),
  studentName: incident.studentName || '',
  className: incident.className,
  subject: incident.subject,
  teacherId: String(incident.teacherId),
  teacherName: incident.teacherName || '',
  severity: incident.severity,
  description: incident.description,
  parentNotification: {
    sentAt: incident.parentNotification?.sentAt || null,
    status: incident.parentNotification?.status || 'pending',
    channel: incident.parentNotification?.channel || 'sms',
    readAt: incident.parentNotification?.readAt || null,
    respondedAt: incident.parentNotification?.respondedAt || null,
    responseText: incident.parentNotification?.responseText || '',
  },
  createdAt: incident.createdAt,
  updatedAt: incident.updatedAt,
});

const logIncident = async (req, res) => {
  try {
    const studentId = asTrimmed(req.body?.studentId);
    const className = asTrimmed(req.body?.className);
    const subject = asTrimmed(req.body?.subject || req.user.subject || req.user.subjects?.[0]);
    const severity = asTrimmed(req.body?.severity).toLowerCase();
    const description = asTrimmed(req.body?.description);

    if (!studentId || !className || !subject || !description || !['low', 'medium', 'high'].includes(severity)) {
      return res.status(400).json({ message: 'Incident payload is incomplete or invalid.' });
    }

    if (!req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'You are not allowed to log incidents for this class.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], subject)) {
      return res.status(403).json({ message: 'You are not allowed to log incidents for this subject.' });
    }

    const student = await User.findOne(
      {
        _id: studentId,
        role: 'student',
        classes: className,
      },
      { name: 1 }
    ).lean();

    if (!student) {
      return res.status(404).json({ message: 'Student not found in the selected class.' });
    }

    const created = await Incident.create({
      studentId,
      studentName: student.name || '',
      className,
      subject,
      teacherId: req.user.id,
      teacherName: req.user.name || '',
      severity,
      description,
      parentNotification: {
        sentAt: new Date(),
        status: 'pending',
        channel: 'sms',
        readAt: null,
        respondedAt: null,
        responseText: '',
      },
    });

    return res.status(201).json({ incident: mapIncident(created.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to log incident.' });
  }
};

const updateIncidentParentStatus = async (req, res) => {
  try {
    const incidentId = asTrimmed(req.params?.id);
    const status = asTrimmed(req.body?.status).toLowerCase();
    const responseText = asTrimmed(req.body?.responseText);

    if (!incidentId || !['pending', 'read', 'responded'].includes(status)) {
      return res.status(400).json({ message: 'Parent notification status is invalid.' });
    }

    const incident = await Incident.findById(incidentId);
    if (!incident) {
      return res.status(404).json({ message: 'Incident not found.' });
    }

    if (req.user.role === 'teacher' && String(incident.teacherId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'You are not allowed to update this incident.' });
    }

    incident.parentNotification.status = status;
    if (status === 'read' && !incident.parentNotification.readAt) {
      incident.parentNotification.readAt = new Date();
    }

    if (status === 'responded') {
      incident.parentNotification.respondedAt = new Date();
      if (!incident.parentNotification.readAt) {
        incident.parentNotification.readAt = incident.parentNotification.respondedAt;
      }
      incident.parentNotification.responseText = responseText;
    } else if (responseText) {
      incident.parentNotification.responseText = responseText;
    }

    await incident.save();
    return res.json({ incident: mapIncident(incident.toObject()) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update parent notification.' });
  }
};

const listTeacherIncidents = async (req, res) => {
  try {
    const className = asTrimmed(req.query?.className);
    const severity = asTrimmed(req.query?.severity).toLowerCase();

    if (className && !req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'You are not allowed to view this class incidents.' });
    }

    const query = {
      teacherId: req.user.id,
      className: className || { $in: req.user.classes || [] },
    };

    if (['low', 'medium', 'high'].includes(severity)) {
      query.severity = severity;
    }

    const incidents = await Incident.find(query).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ incidents: incidents.map(mapIncident) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load incidents.' });
  }
};

const listAdminIncidents = async (req, res) => {
  try {
    const className = asTrimmed(req.query?.className);
    const severity = asTrimmed(req.query?.severity).toLowerCase();
    const teacherId = asTrimmed(req.query?.teacherId);

    const query = {};
    if (className) {
      query.className = className;
    }
    if (teacherId) {
      query.teacherId = teacherId;
    }
    if (['low', 'medium', 'high'].includes(severity)) {
      query.severity = severity;
    }

    const incidents = await Incident.find(query).sort({ createdAt: -1 }).limit(1000).lean();
    return res.json({ incidents: incidents.map(mapIncident) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load incidents.' });
  }
};

module.exports = {
  listAdminIncidents,
  listTeacherIncidents,
  logIncident,
  updateIncidentParentStatus,
};
