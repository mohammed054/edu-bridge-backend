const ClassModel = require('../models/Class');
const Feedback = require('../models/Feedback');
const User = require('../models/User');

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asTrimmed = (value) => String(value || '').trim();

const TAG_FALLBACK_MAP = {
  'good participation': 'مشاركتك داخل الصف مميزة وتعكس اهتمامك بالتعلم.',
  'talks too much': 'نحتاج منك تقليل الحديث الجانبي أثناء الشرح لزيادة التركيز.',
  'academic improvement': 'هناك تحسن أكاديمي واضح خلال الفترة الأخيرة ونشجعك على الاستمرار.',
  'needs focus': 'من المهم زيادة التركيز في الحصة لتحقيق نتائج أفضل.',
  'excellent behavior': 'سلوكك داخل الصف ممتاز ويعكس احترامك لبيئة التعلم.',
  'homework incomplete': 'يرجى الالتزام بتسليم الواجبات في الوقت المحدد.',
};

const buildFallbackMessage = (studentName, tags, notes) => {
  const selectedLines = tags
    .map((tag) => TAG_FALLBACK_MAP[tag])
    .filter(Boolean)
    .slice(0, 2);

  const highlights =
    selectedLines.length > 0
      ? selectedLines.join(' ')
      : 'شكرًا لجهودك داخل الصف. نأمل الاستمرار في التطور الأكاديمي والسلوكي.';

  const notesLine = notes ? `ملاحظة المعلم: ${notes.trim()}.` : '';
  return `عزيزي/عزيزتي ${studentName}، ${highlights} ${notesLine} مع خالص التقدير.`;
};

const generateArabicMessageWithAI = async ({ studentName, tags, notes, senderType }) => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API key is missing');
  }

  const systemPrompt =
    'أنت مساعد تربوي محترف. اكتب رسالة تغذية راجعة عربية قصيرة (2-3 جمل)، دافئة ومهنية ومختصرة، موجهة للطالب وولي الأمر.';
  const userPrompt = `اسم الطالب: ${studentName}
نوع المرسل: ${senderType}
الوسوم المختارة: ${tags.join('، ') || 'بدون'}
ملاحظات إضافية: ${notes || 'لا توجد'}
اكتب رسالة واضحة ومحترمة وتحتوي توجيهًا عمليًا بسيطًا.`;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5000',
      'X-Title': 'Edu Bridge Feedback Platform',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 170,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter request failed: ${errorText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('OpenRouter returned empty content');
  }

  return text;
};

const parseFeedbackTypes = (query) => {
  const rawTypes = asTrimmed(query.feedbackType || query.type);
  if (!rawTypes) {
    return [];
  }

  return [...new Set(rawTypes.split(',').map((item) => item.trim()).filter(Boolean))];
};

const applyRoleScope = (query, reqUser) => {
  if (reqUser.role === 'admin') {
    return query;
  }

  if (reqUser.role === 'student') {
    return {
      $and: [query, { $or: [{ studentId: reqUser.id }, { senderId: reqUser.id }] }],
    };
  }

  if (reqUser.role === 'teacher') {
    return {
      $and: [
        query,
        {
          $or: [{ teacherId: reqUser.id }, { senderId: reqUser.id }, { receiverId: reqUser.id }],
        },
      ],
    };
  }

  return query;
};

const resolveStudentAndClass = async ({ studentId, studentName, className }) => {
  let student = null;

  if (studentId) {
    student = await User.findOne({ _id: studentId, role: 'student' });
  } else if (studentName) {
    student = await User.findOne({
      role: 'student',
      name: new RegExp(`^${escapeRegExp(studentName.trim())}$`, 'i'),
    });
  }

  if (!student) {
    throw new Error('Student not found.');
  }

  const preferredClassNames = [className, ...(student.classes || [])].filter(Boolean);
  let targetClass = null;

  for (const candidate of preferredClassNames) {
    // eslint-disable-next-line no-await-in-loop
    targetClass = await ClassModel.findOne({ name: candidate });
    if (targetClass) {
      break;
    }
  }

  if (!targetClass) {
    targetClass = await ClassModel.findOne().sort({ createdAt: 1 });
  }

  if (!targetClass) {
    throw new Error('No class is available. Seed data first.');
  }

  return { student, targetClass };
};

const ensureSharedClass = (leftClasses = [], rightClasses = []) => {
  const leftSet = new Set(leftClasses);
  return rightClasses.some((className) => leftSet.has(className));
};

const getFeedbackOptions = async (req, res) => {
  try {
    const classQuery =
      req.user.role !== 'admin'
        ? req.user.classes?.length
          ? { name: { $in: req.user.classes } }
          : { _id: null }
        : {};

    const classes = await ClassModel.find(classQuery).sort({ createdAt: 1 }).lean();
    const students = await User.find(
      req.user.role === 'student' ? { _id: req.user.id, role: 'student' } : { role: 'student' }
    )
      .sort({ name: 1 })
      .lean();
    const teachers = await User.find({ role: 'teacher' }).sort({ name: 1 }).lean();

    const payload = classes.map((item) => ({
      id: String(item._id),
      name: item.name,
      grade: item.grade,
      section: item.section,
      students: students
        .filter((student) => (student.classes || []).includes(item.name))
        .map((student) => ({
          id: String(student._id),
          name: student.name,
          email: student.email,
        })),
      teachers: teachers
        .filter((teacher) => (teacher.classes || []).includes(item.name))
        .map((teacher) => ({
          id: String(teacher._id),
          name: teacher.name,
          email: teacher.email,
        })),
    }));

    const admins = await User.find({ role: 'admin' }, { name: 1, username: 1, email: 1 }).lean();

    return res.json({
      classes: payload,
      admins: admins.map((admin) => ({
        id: String(admin._id),
        name: admin.name || admin.username || 'Admin',
        email: admin.email || '',
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load options.' });
  }
};

const generateFeedback = async (req, res) => {
  try {
    const {
      studentName,
      studentId,
      tags = [],
      notes = '',
      className = '',
      suggestion = '',
    } = req.body || {};

    if (!studentName && !studentId) {
      return res.status(400).json({ message: 'studentName or studentId is required.' });
    }
    if (!Array.isArray(tags)) {
      return res.status(400).json({ message: 'tags must be an array.' });
    }

    const { student, targetClass } = await resolveStudentAndClass({ studentId, studentName, className });

    if (
      req.user.role === 'teacher' &&
      req.user.classes?.length &&
      !req.user.classes.includes(targetClass.name)
    ) {
      return res
        .status(403)
        .json({ message: 'Teachers can only send feedback to students in their classes.' });
    }

    const senderRole = req.user.role === 'admin' ? 'admin' : 'teacher';
    const senderName = req.user?.name || (senderRole === 'admin' ? 'Admin' : 'Teacher');

    let message;
    try {
      message = await generateArabicMessageWithAI({
        studentName: student.name,
        tags,
        notes,
        senderType: senderRole,
      });
    } catch (apiError) {
      console.warn('AI generation failed, using fallback:', apiError.message);
      message = buildFallbackMessage(student.name, tags, notes);
    }

    const created = await Feedback.create({
      studentId: student._id,
      studentName: student.name,
      classId: targetClass._id,
      className: targetClass.name,
      teacherId: senderRole === 'teacher' ? req.user.id : null,
      teacherName: senderRole === 'teacher' ? senderName : '',
      adminId: senderRole === 'admin' ? req.user.id : null,
      adminName: senderRole === 'admin' ? senderName : '',
      senderId: req.user.id,
      senderRole,
      senderType: senderRole,
      receiverId: student._id,
      receiverRole: 'student',
      feedbackType: senderRole === 'admin' ? 'admin_feedback' : 'teacher_feedback',
      tags,
      notes: asTrimmed(notes),
      suggestion: asTrimmed(suggestion),
      message,
      content: message,
      timestamp: new Date(),
    });

    return res.status(201).json({
      message,
      feedback: created,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to generate feedback.' });
  }
};

const submitStudentToTeacherFeedback = async (req, res) => {
  try {
    const teacherId = asTrimmed(req.body?.teacherId);
    const content = asTrimmed(req.body?.content);
    const feedbackType = 'student_to_teacher';

    if (!teacherId || !content) {
      return res.status(400).json({ message: 'teacherId and content are required.' });
    }

    const [student, teacher] = await Promise.all([
      User.findOne({ _id: req.user.id, role: 'student' }),
      User.findOne({ _id: teacherId, role: 'teacher' }),
    ]);

    if (!student) {
      return res.status(404).json({ message: 'Student account not found.' });
    }
    if (!teacher) {
      return res.status(404).json({ message: 'Teacher not found.' });
    }
    if (!ensureSharedClass(student.classes || [], teacher.classes || [])) {
      return res
        .status(403)
        .json({ message: 'You can only send feedback to teachers assigned to your class.' });
    }

    const className =
      asTrimmed(req.body?.className) ||
      (student.classes || []).find((classItem) => (teacher.classes || []).includes(classItem)) ||
      '';
    const classItem = className ? await ClassModel.findOne({ name: className }) : null;

    const feedback = await Feedback.create({
      studentId: student._id,
      studentName: student.name,
      classId: classItem?._id || null,
      className,
      teacherId: teacher._id,
      teacherName: teacher.name,
      senderId: student._id,
      senderRole: 'student',
      senderType: 'student',
      receiverId: teacher._id,
      receiverRole: 'teacher',
      feedbackType,
      message: content,
      content,
      timestamp: new Date(),
    });

    return res.status(201).json({ feedback });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || 'Failed to submit student-to-teacher feedback.' });
  }
};

const submitStudentToAdminFeedback = async (req, res) => {
  try {
    const requestedAdminId = asTrimmed(req.body?.adminId);
    const content = asTrimmed(req.body?.content);
    const feedbackType = 'student_to_admin';

    if (!content) {
      return res.status(400).json({ message: 'content is required.' });
    }

    const student = await User.findOne({ _id: req.user.id, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'Student account not found.' });
    }

    const adminQuery = requestedAdminId
      ? { _id: requestedAdminId, role: 'admin' }
      : { role: 'admin' };
    const admin = await User.findOne(adminQuery).sort({ createdAt: 1 });
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found.' });
    }

    const className = asTrimmed(req.body?.className) || (student.classes || [])[0] || '';
    const classItem = className ? await ClassModel.findOne({ name: className }) : null;

    const feedback = await Feedback.create({
      studentId: student._id,
      studentName: student.name,
      classId: classItem?._id || null,
      className,
      adminId: admin._id,
      adminName: admin.name || admin.username || 'Admin',
      senderId: student._id,
      senderRole: 'student',
      senderType: 'student',
      receiverId: admin._id,
      receiverRole: 'admin',
      feedbackType,
      message: content,
      content,
      timestamp: new Date(),
    });

    return res.status(201).json({ feedback });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || 'Failed to submit student-to-admin feedback.' });
  }
};

const listFeedbacks = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const feedbackTypes = parseFeedbackTypes(req.query);
    const query = {};

    if (asTrimmed(req.query.studentId)) {
      query.studentId = asTrimmed(req.query.studentId);
    }
    if (asTrimmed(req.query.teacherId)) {
      query.teacherId = asTrimmed(req.query.teacherId);
    }
    if (asTrimmed(req.query.adminId)) {
      query.adminId = asTrimmed(req.query.adminId);
    }
    if (asTrimmed(req.query.className)) {
      query.className = asTrimmed(req.query.className);
    }
    if (asTrimmed(req.query.senderRole)) {
      query.senderRole = asTrimmed(req.query.senderRole);
    }
    if (asTrimmed(req.query.receiverRole)) {
      query.receiverRole = asTrimmed(req.query.receiverRole);
    }
    if (feedbackTypes.length === 1) {
      query.feedbackType = feedbackTypes[0];
    } else if (feedbackTypes.length > 1) {
      query.feedbackType = { $in: feedbackTypes };
    }
    if (asTrimmed(req.query.studentName)) {
      query.studentName = new RegExp(`^${escapeRegExp(asTrimmed(req.query.studentName))}$`, 'i');
    }

    const scopedQuery = applyRoleScope(query, req.user);
    const feedbacks = await Feedback.find(scopedQuery).sort({ createdAt: -1 }).limit(limit).lean();

    return res.json({ feedbacks });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch feedbacks.' });
  }
};

const addReply = async (req, res) => {
  try {
    const feedbackId = asTrimmed(req.body?.feedbackId);
    const text = asTrimmed(req.body?.text);

    if (!feedbackId || !text) {
      return res.status(400).json({ message: 'feedbackId and text are required.' });
    }

    const existing = await Feedback.findById(feedbackId).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Feedback not found.' });
    }

    if (String(existing.studentId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'You can only reply to your own feedback.' });
    }

    const feedback = await Feedback.findByIdAndUpdate(
      feedbackId,
      {
        $push: {
          replies: {
            senderType: 'student',
            text,
            createdAt: new Date(),
          },
        },
      },
      { new: true }
    ).lean();

    return res.json({ feedback });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to add reply.' });
  }
};

module.exports = {
  getFeedbackOptions,
  generateFeedback,
  submitStudentToTeacherFeedback,
  submitStudentToAdminFeedback,
  listFeedbacks,
  addReply,
};
