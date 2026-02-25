const ClassModel = require('../models/Class');
const Feedback = require('../models/Feedback');
const User = require('../models/User');

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const resolveStudentAndClass = async ({ studentName, className }) => {
  const targetClass =
    (className && (await ClassModel.findOne({ name: className }))) ||
    (await ClassModel.findOne({ name: 'Grade 11 Adv 3' })) ||
    (await ClassModel.findOne().sort({ createdAt: 1 }));

  if (!targetClass) {
    throw new Error('No class is available. Seed data first.');
  }

  const student = await User.findOne({
    role: 'student',
    name: new RegExp(`^${escapeRegExp(studentName.trim())}$`, 'i'),
    classes: targetClass.name,
  });

  if (!student) {
    throw new Error('Student not found in selected class.');
  }

  return { student, targetClass };
};

const getFeedbackOptions = async (_req, res) => {
  try {
    const classes = await ClassModel.find().sort({ createdAt: 1 }).lean();
    const students = await User.find({ role: 'student' }).sort({ name: 1 }).lean();

    const payload = classes.map((item) => ({
      id: item._id,
      name: item.name,
      grade: item.grade,
      section: item.section,
      students: students
        .filter((student) => (student.classes || []).includes(item.name))
        .map((student) => ({
          id: student._id,
          name: student.name,
          email: student.email,
        })),
    }));

    res.json({ classes: payload });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to load options' });
  }
};

const generateFeedback = async (req, res) => {
  try {
    const {
      studentName,
      tags = [],
      notes = '',
      senderType = 'teacher',
      className = 'Grade 11 Adv 3',
      suggestion = '',
    } = req.body || {};

    if (!studentName || typeof studentName !== 'string') {
      return res.status(400).json({ message: 'studentName is required' });
    }
    if (!Array.isArray(tags)) {
      return res.status(400).json({ message: 'tags must be an array' });
    }

    const { student, targetClass } = await resolveStudentAndClass({ studentName, className });
    const teacherName = req.user?.name || 'Teacher';

    let message;
    try {
      message = await generateArabicMessageWithAI({ studentName, tags, notes, senderType });
    } catch (apiError) {
      console.warn('AI generation failed, using fallback:', apiError.message);
      message = buildFallbackMessage(studentName, tags, notes);
    }

    await Feedback.create({
      studentId: student._id,
      studentName: student.name,
      classId: targetClass._id,
      className: targetClass.name,
      teacherId: req.user?.id || null,
      teacherName,
      senderType,
      tags,
      notes,
      suggestion,
      message,
    });

    return res.status(201).json({ message });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to generate feedback' });
  }
};

const listFeedbacks = async (req, res) => {
  try {
    const { studentId, studentName, className } = req.query;
    const query = {};

    if (req.user.role === 'student') {
      query.studentId = req.user.id;
    } else if (studentId) {
      query.studentId = studentId;
    }
    if (studentName) {
      query.studentName = new RegExp(`^${escapeRegExp(String(studentName).trim())}$`, 'i');
    }
    if (className) {
      query.className = className;
    }

    const feedbacks = await Feedback.find(query).sort({ createdAt: -1 }).lean();
    return res.json({ feedbacks });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch feedbacks' });
  }
};

const addReply = async (req, res) => {
  try {
    const { feedbackId, text } = req.body || {};
    if (!feedbackId || !text || !String(text).trim()) {
      return res.status(400).json({ message: 'feedbackId and text are required' });
    }

    const existing = await Feedback.findById(feedbackId).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Feedback not found' });
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
            text: String(text).trim(),
            createdAt: new Date(),
          },
        },
      },
      { new: true }
    ).lean();

    return res.json({ feedback });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to add reply' });
  }
};

module.exports = {
  getFeedbackOptions,
  generateFeedback,
  listFeedbacks,
  addReply,
};
