const Announcement = require('../models/Announcement');
const Feedback = require('../models/Feedback');
const Homework = require('../models/Homework');
const ScheduleEntry = require('../models/ScheduleEntry');
const User = require('../models/User');
const { buildStudentWeeklySnapshot } = require('../services/intelligenceService');
const { listPublishedBroadcastsForUser } = require('../services/broadcastService');
const { sendServerError } = require('../utils/safeError');

const SCHOOL_DAY_RANGE = [1, 2, 3, 4, 5];

const asTrimmed = (value) => String(value || '').trim();

const toSubjectKey = (subjectName) =>
  asTrimmed(subjectName)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\u0600-\u06ff\w-]/g, '');

const mapAssignmentStatus = (status) => {
  if (status === 'submitted' || status === 'graded') {
    return 'مكتمل';
  }
  return 'غير مكتمل';
};

const mapFeedbackItem = (item) => ({
  id: String(item._id),
  subjectName: item.subject || '',
  category: item.category || '',
  preview: item.message || item.content || item.text || '',
  date: item.createdAt,
});

const getStudentPortalData = async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.user.id, role: 'student' }, {
      name: 1,
      email: 1,
      classes: 1,
      profilePicture: 1,
      avatarUrl: 1,
      examMarks: 1,
    }).lean();

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    const className = student.classes?.[0] || '';
    if (!className) {
      return res.json({
        student: {
          id: String(student._id),
          name: student.name || '',
          className: '',
          avatarUrl: student.profilePicture || student.avatarUrl || '',
        },
        subjects: [],
        recentFeedback: [],
        announcements: [],
      });
    }

    const [announcements, homeworkDocs, feedbackDocs, teachers, scheduleEntries, weeklySnapshot, broadcasts] = await Promise.all([
      Announcement.find({ className }).sort({ createdAt: -1 }).lean(),
      Homework.find({ className }).sort({ createdAt: -1 }).lean(),
      Feedback.find(
        {
          studentId: student._id,
          feedbackType: { $in: ['teacher_feedback', 'admin_feedback'] },
        },
        {
          subject: 1,
          category: 1,
          message: 1,
          content: 1,
          text: 1,
          createdAt: 1,
        }
      )
        .sort({ createdAt: -1 })
        .lean(),
      User.find({ role: 'teacher', classes: className }, { name: 1, subject: 1, subjects: 1 }).lean(),
      ScheduleEntry.find(
        { className, isActive: true, dayOfWeek: { $in: SCHOOL_DAY_RANGE } },
        { subject: 1 }
      ).lean(),
      buildStudentWeeklySnapshot(student._id),
      listPublishedBroadcastsForUser({
        role: 'student',
        userId: String(student._id),
        classes: [className],
      }),
    ]);

    const subjectsSet = new Set();

    teachers.forEach((teacher) => {
      const subject = asTrimmed(teacher.subject || teacher.subjects?.[0]);
      if (subject) {
        subjectsSet.add(subject);
      }
    });

    announcements.forEach((item) => {
      if (asTrimmed(item.subject)) {
        subjectsSet.add(asTrimmed(item.subject));
      }
    });

    homeworkDocs.forEach((item) => {
      if (asTrimmed(item.subject)) {
        subjectsSet.add(asTrimmed(item.subject));
      }
    });

    (student.examMarks || []).forEach((item) => {
      if (asTrimmed(item.subject)) {
        subjectsSet.add(asTrimmed(item.subject));
      }
    });

    feedbackDocs.forEach((item) => {
      if (asTrimmed(item.subject)) {
        subjectsSet.add(asTrimmed(item.subject));
      }
    });

    scheduleEntries.forEach((item) => {
      if (asTrimmed(item.subject)) {
        subjectsSet.add(asTrimmed(item.subject));
      }
    });

    const teacherBySubject = teachers.reduce((acc, teacher) => {
      const subject = asTrimmed(teacher.subject || teacher.subjects?.[0]);
      if (subject && !acc[subject]) {
        acc[subject] = teacher.name || '';
      }
      return acc;
    }, {});

    const subjects = [...subjectsSet].sort((left, right) => left.localeCompare(right)).map((subjectName) => {
      const posts = announcements
        .filter((item) => asTrimmed(item.subject) === subjectName)
        .map((item) => ({
          id: String(item._id),
          title: item.title || '',
          date: item.createdAt,
          body: item.body || '',
          attachments: item.attachmentName ? [item.attachmentName] : [],
        }));

      const homework = homeworkDocs
        .filter((item) => asTrimmed(item.subject) === subjectName)
        .map((item) => {
          const assignment = (item.assignments || []).find(
            (entry) => String(entry.studentId) === String(student._id)
          );

          return {
            id: String(item._id),
            title: item.title || '',
            dueDate: item.dueDate,
            status: mapAssignmentStatus(assignment?.status),
            attachment: item.attachmentName || '',
            teacherComment: assignment?.teacherComment || '',
          };
        });

      const grades = (student.examMarks || [])
        .filter((item) => asTrimmed(item.subject) === subjectName)
        .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
        .map((item) => ({
          id: `${subjectName}-${item.updatedAt || item.examTitle}`,
          assessment: item.examTitle || 'تقييم',
          score: Number(item.rawScore ?? item.score ?? 0),
          outOf: Number(item.maxMarks || 100),
          date: item.updatedAt || null,
        }));

      const feedbackItems = feedbackDocs
        .filter((item) => asTrimmed(item.subject) === subjectName)
        .map(mapFeedbackItem);

      return {
        id: toSubjectKey(subjectName) || subjectName,
        name: subjectName,
        teacher: teacherBySubject[subjectName] || '',
        posts,
        homework,
        grades,
        feedbackItems,
      };
    });

    return res.json({
      student: {
        id: String(student._id),
        name: student.name || '',
        className,
        avatarUrl: student.profilePicture || student.avatarUrl || '',
      },
      weeklySnapshot,
      subjects,
      recentFeedback: feedbackDocs.slice(0, 8).map(mapFeedbackItem),
      announcements: [
        ...announcements.map((item) => ({
          id: String(item._id),
          title: item.title || '',
          description: item.body || '',
          date: item.createdAt,
          subject: item.subject || '',
          source: 'teacher',
        })),
        ...(broadcasts || []).map((item) => ({
          id: item.id,
          title: item.title || '',
          description: [item.body, item.actionLine].filter(Boolean).join(' '),
          date: item.publishedAt || item.createdAt,
          subject: 'Broadcast',
          source: 'admin',
        })),
      ].sort((left, right) => new Date(right.date) - new Date(left.date)),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load student portal data.');
  }
};

module.exports = {
  getStudentPortalData,
};
