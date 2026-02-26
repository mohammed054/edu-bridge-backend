const ClassModel = require('../models/Class');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const { HIKMAH_SUBJECTS } = require('../constants/subjects');
const {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_KEYS,
  FEEDBACK_CATEGORY_LABEL_BY_KEY,
} = require('../constants/feedbackCatalog');

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asTrimmed = (value) => String(value || '').trim();

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => asTrimmed(item)).filter(Boolean))];
};

const normalizeCategories = (value) =>
  normalizeStringArray(value).filter((item) => FEEDBACK_CATEGORY_KEYS.includes(item));

const normalizeCategoryDetails = (value = {}) => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.entries(value).reduce((acc, [key, list]) => {
    const cleanKey = asTrimmed(key);
    if (!cleanKey) {
      return acc;
    }

    acc[cleanKey] = normalizeStringArray(list);
    return acc;
  }, {});
};

const flattenTagsFromDetails = (details) =>
  [...new Set(Object.values(details || {}).flatMap((list) => normalizeStringArray(list)))];

const hasSubjectAccess = (teacherSubjects, subject) =>
  (teacherSubjects || []).some(
    (entry) => String(entry || '').toLowerCase() === String(subject || '').toLowerCase()
  );

const buildFallbackMessage = (studentName, subject, categories, notes) => {
  const labels = categories.map((key) => FEEDBACK_CATEGORY_LABEL_BY_KEY[key]).filter(Boolean);
  const summary = labels.length ? labels.join('? ') : '?????? ????';
  const notesLine = notes ? ` ?????? ??????: ${notes}.` : '';
  return `?? ????? ????? ????? ??????/? ${studentName} ?? ???? ${subject} ??? ??? ${summary}.${notesLine}`.trim();
};

const buildAiAnalysisPlaceholder = ({ categories, categoryDetails, notes }) => ({
  status: 'placeholder',
  categories,
  categoryDetails,
  notes,
  updatedAt: new Date().toISOString(),
});

const generateArabicMessageWithAI = async ({
  studentName,
  subject,
  categories,
  categoryDetails,
  notes,
  senderType,
}) => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('????? ?????? ????????? ??? ?????.');
  }

  const detailsText = Object.entries(categoryDetails || {})
    .map(([key, values]) => `${key}: ${(values || []).join('? ') || '?? ????'}`)
    .join('\n');

  const systemPrompt =
    '??? ????? ????? ?????. ???? ????? ????? ????? ????? ????? ?????? ?????? ?????? ???????.';
  const userPrompt = `??? ??????: ${studentName}
??? ??????: ${senderType}
??????: ${subject}
??????: ${categories.map((key) => FEEDBACK_CATEGORY_LABEL_BY_KEY[key]).join('? ') || '????'}
?????? ??????:
${detailsText || '?? ????'}
??????? ??????: ${notes || '?? ????'}
???? ??????? ?? 2-3 ???.`;

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5000',
      'X-Title': 'Hikmah School Platform',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 220,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`???? ????? ???????: ${errorText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('?? ??? ????? ?? ?????.');
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

const parseCategoryFilter = (value) => normalizeCategories(String(value || '').split(','));

const applyRoleScope = (query, reqUser) => {
  if (reqUser.role === 'admin') {
    return query;
  }

  if (reqUser.role === 'student') {
    return {
      $and: [query, { $or: [{ studentId: reqUser.id }, { senderId: reqUser.id }, { receiverId: reqUser.id }] }],
    };
  }

  if (reqUser.role === 'teacher') {
    const subjects = reqUser.subjects || [];
    const teacherScope = {
      $or: [{ teacherId: reqUser.id }, { senderId: reqUser.id }, { receiverId: reqUser.id }],
    };

    if (!subjects.length) {
      return { $and: [query, teacherScope] };
    }

    return {
      $and: [
        query,
        teacherScope,
        {
          $or: [{ subject: { $in: subjects } }, { subject: '' }, { subject: null }],
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
    throw new Error('?????? ??? ?????.');
  }

  const studentClass = (student.classes || [])[0] || '';
  const preferredClassNames = [className, studentClass].filter(Boolean);
  let targetClass = null;

  for (const candidate of preferredClassNames) {
    // eslint-disable-next-line no-await-in-loop
    targetClass = await ClassModel.findOne({ name: candidate });
    if (targetClass) {
      break;
    }
  }

  if (!targetClass) {
    throw new Error('?? ???? ?? ????? ???????.');
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

    const [classes, students, teachers, admins] = await Promise.all([
      ClassModel.find(classQuery).sort({ createdAt: 1 }).lean(),
      User.find(req.user.role === 'student' ? { _id: req.user.id, role: 'student' } : { role: 'student' })
        .sort({ name: 1 })
        .lean(),
      User.find({ role: 'teacher' }).sort({ name: 1 }).lean(),
      User.find({ role: 'admin' }, { name: 1, username: 1, email: 1, profilePicture: 1, avatarUrl: 1 }).lean(),
    ]);

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
          avatarUrl: student.profilePicture || student.avatarUrl || '',
        })),
      teachers: teachers
        .filter((teacher) => (teacher.classes || []).includes(item.name))
        .map((teacher) => ({
          id: String(teacher._id),
          name: teacher.name,
          email: teacher.email,
          avatarUrl: teacher.profilePicture || teacher.avatarUrl || '',
          subjects: teacher.subject ? [teacher.subject] : teacher.subjects || [],
          subject: teacher.subject || teacher.subjects?.[0] || '',
        })),
    }));

    const subjectsByRole = {
      admin: HIKMAH_SUBJECTS,
      teacher: req.user.subjects || [],
      student: HIKMAH_SUBJECTS,
    };

    return res.json({
      classes: payload,
      admins: admins.map((admin) => ({
        id: String(admin._id),
        name: admin.name || admin.username || '???????',
        email: admin.email || '',
        avatarUrl: admin.profilePicture || admin.avatarUrl || '',
      })),
      categories: FEEDBACK_CATEGORIES,
      subjects: subjectsByRole[req.user.role] || HIKMAH_SUBJECTS,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ?????? ??????? ???????.' });
  }
};

const generateFeedback = async (req, res) => {
  try {
    const {
      studentName,
      studentId,
      className = '',
      subject = '',
      categories = [],
      categoryDetails = {},
      notes = '',
      suggestion = '',
      content = '',
      subcategory = '',
      suggestAi = true,
    } = req.body || {};

    const normalizedSubject = asTrimmed(subject);
    const normalizedCategories = normalizeCategories(categories);
    const normalizedDetails = normalizeCategoryDetails(categoryDetails);
    const normalizedNotes = asTrimmed(notes);
    const normalizedContent = asTrimmed(content);
    const normalizedSubcategory = asTrimmed(subcategory);

    if (!studentName && !studentId) {
      return res.status(400).json({ message: '??? ????? ??????.' });
    }
    if (!normalizedSubject) {
      return res.status(400).json({ message: '?????? ??????.' });
    }
    if (!normalizedCategories.length) {
      return res.status(400).json({ message: '??? ?????? ??? ????? ??? ?????.' });
    }

    const { student, targetClass } = await resolveStudentAndClass({ studentId, studentName, className });

    if (
      req.user.role === 'teacher' &&
      req.user.classes?.length &&
      !req.user.classes.includes(targetClass.name)
    ) {
      return res.status(403).json({ message: '???? ?????? ??????? ?????? ???.' });
    }

    if (req.user.role === 'teacher' && !hasSubjectAccess(req.user.subjects || [], normalizedSubject)) {
      return res.status(403).json({ message: '???? ?????? ??????? ?? ????? ???.' });
    }

    const senderRole = req.user.role === 'admin' ? 'admin' : 'teacher';
    const senderName = req.user?.name || (senderRole === 'admin' ? '???????' : '??????');

    let message = normalizedContent;
    if (!message && suggestAi) {
      try {
        message = await generateArabicMessageWithAI({
          studentName: student.name,
          subject: normalizedSubject,
          categories: normalizedCategories,
          categoryDetails: normalizedDetails,
          notes: normalizedNotes,
          senderType: senderRole,
        });
      } catch {
        message = '';
      }
    }

    if (!message) {
      message = buildFallbackMessage(student.name, normalizedSubject, normalizedCategories, normalizedNotes);
    }

    const tags = flattenTagsFromDetails(normalizedDetails);

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
      subject: normalizedSubject,
      category: normalizedCategories[0],
      subcategory: normalizedSubcategory,
      categories: normalizedCategories,
      categoryDetails: normalizedDetails,
      tags,
      notes: normalizedNotes,
      suggestion: asTrimmed(suggestion),
      text: message,
      message,
      content: message,
      AIAnalysis: buildAiAnalysisPlaceholder({
        categories: normalizedCategories,
        categoryDetails: normalizedDetails,
        notes: normalizedNotes,
      }),
      timestamp: new Date(),
    });

    await User.updateOne({ _id: student._id }, { $addToSet: { feedbackHistory: created._id } });

    return res.status(201).json({
      message,
      feedback: created,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??????? ???????.' });
  }
};

const submitStudentToTeacherFeedback = async (req, res) => {
  try {
    const teacherId = asTrimmed(req.body?.teacherId);
    const content = asTrimmed(req.body?.content);
    const subject = asTrimmed(req.body?.subject);
    const categories = normalizeCategories(req.body?.categories || []);
    const categoryDetails = normalizeCategoryDetails(req.body?.categoryDetails || {});
    const notes = asTrimmed(req.body?.notes);
    const subcategory = asTrimmed(req.body?.subcategory);

    if (!teacherId || !subject) {
      return res.status(400).json({ message: '?????? ??????? ???? ??????.' });
    }
    if (!categories.length) {
      return res.status(400).json({ message: '??? ?????? ??? ????? ??? ?????.' });
    }

    const [student, teacher] = await Promise.all([
      User.findOne({ _id: req.user.id, role: 'student' }),
      User.findOne({ _id: teacherId, role: 'teacher' }),
    ]);

    if (!student) {
      return res.status(404).json({ message: '???? ?????? ??? ?????.' });
    }
    if (!teacher) {
      return res.status(404).json({ message: '?????? ??? ?????.' });
    }
    if (!ensureSharedClass(student.classes || [], teacher.classes || [])) {
      return res.status(403).json({ message: '????? ??????? ?????? ??? ???.' });
    }
    if (!hasSubjectAccess(teacher.subject ? [teacher.subject] : teacher.subjects || [], subject)) {
      return res.status(403).json({ message: '?????? ??? ?????? ???? ??????.' });
    }

    const className =
      asTrimmed(req.body?.className) ||
      (student.classes || []).find((classItem) => (teacher.classes || []).includes(classItem)) ||
      '';
    const classItem = className ? await ClassModel.findOne({ name: className }) : null;

    const firstCategoryLabel = FEEDBACK_CATEGORY_LABEL_BY_KEY[categories[0]] || '????? ?????';
    const resolvedContent = content || `?? ????? ${firstCategoryLabel} ?? ??????.`;

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
      feedbackType: 'student_to_teacher',
      subject,
      category: categories[0],
      subcategory,
      categories,
      categoryDetails,
      tags: flattenTagsFromDetails(categoryDetails),
      notes,
      text: resolvedContent,
      message: resolvedContent,
      content: resolvedContent,
      AIAnalysis: buildAiAnalysisPlaceholder({ categories, categoryDetails, notes }),
      timestamp: new Date(),
    });

    return res.status(201).json({ feedback });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??????? ??????? ??????.' });
  }
};

const submitStudentToAdminFeedback = async (req, res) => {
  try {
    const requestedAdminId = asTrimmed(req.body?.adminId);
    const content = asTrimmed(req.body?.content);
    const subject = asTrimmed(req.body?.subject);
    const categories = normalizeCategories(req.body?.categories || []);
    const categoryDetails = normalizeCategoryDetails(req.body?.categoryDetails || {});
    const notes = asTrimmed(req.body?.notes);
    const subcategory = asTrimmed(req.body?.subcategory);

    if (!subject) {
      return res.status(400).json({ message: '?????? ??? ?????.' });
    }
    if (!categories.length) {
      return res.status(400).json({ message: '??? ?????? ??? ????? ??? ?????.' });
    }

    const student = await User.findOne({ _id: req.user.id, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: '???? ?????? ??? ?????.' });
    }

    const adminQuery = requestedAdminId
      ? { _id: requestedAdminId, role: 'admin' }
      : { role: 'admin' };
    const admin = await User.findOne(adminQuery).sort({ createdAt: 1 });
    if (!admin) {
      return res.status(404).json({ message: '???? ??????? ??? ?????.' });
    }

    const className = asTrimmed(req.body?.className) || (student.classes || [])[0] || '';
    const classItem = className ? await ClassModel.findOne({ name: className }) : null;

    const firstCategoryLabel = FEEDBACK_CATEGORY_LABEL_BY_KEY[categories[0]] || '????? ?????';
    const resolvedContent = content || `?? ????? ${firstCategoryLabel} ?? ??????.`;

    const feedback = await Feedback.create({
      studentId: student._id,
      studentName: student.name,
      classId: classItem?._id || null,
      className,
      adminId: admin._id,
      adminName: admin.name || admin.username || '???????',
      senderId: student._id,
      senderRole: 'student',
      senderType: 'student',
      receiverId: admin._id,
      receiverRole: 'admin',
      feedbackType: 'student_to_admin',
      subject,
      category: categories[0],
      subcategory,
      categories,
      categoryDetails,
      tags: flattenTagsFromDetails(categoryDetails),
      notes,
      text: resolvedContent,
      message: resolvedContent,
      content: resolvedContent,
      AIAnalysis: buildAiAnalysisPlaceholder({ categories, categoryDetails, notes }),
      timestamp: new Date(),
    });

    return res.status(201).json({ feedback });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??????? ??????? ???????.' });
  }
};

const listFeedbacks = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const feedbackTypes = parseFeedbackTypes(req.query);
    const query = {};
    const searchText = asTrimmed(req.query.search);
    const categoryFilter = parseCategoryFilter(req.query.category);

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
    if (asTrimmed(req.query.subject)) {
      query.subject = asTrimmed(req.query.subject);
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
      query.studentName = new RegExp(escapeRegExp(asTrimmed(req.query.studentName)), 'i');
    }
    if (asTrimmed(req.query.teacherName)) {
      query.teacherName = new RegExp(escapeRegExp(asTrimmed(req.query.teacherName)), 'i');
    }
    if (categoryFilter.length === 1) {
      query.category = categoryFilter[0];
    } else if (categoryFilter.length > 1) {
      query.category = { $in: categoryFilter };
    }
    if (searchText) {
      const pattern = new RegExp(escapeRegExp(searchText), 'i');
      query.$or = [
        { studentName: pattern },
        { teacherName: pattern },
        { adminName: pattern },
        { className: pattern },
        { subject: pattern },
        { message: pattern },
        { content: pattern },
      ];
    }

    const scopedQuery = applyRoleScope(query, req.user);
    const feedbacks = await Feedback.find(scopedQuery).sort({ createdAt: -1 }).limit(limit).lean();

    return res.json({ feedbacks });
  } catch (error) {
    return res.status(500).json({ message: error.message || '???? ????? ??? ??????? ???????.' });
  }
};

const addReply = async (req, res) => {
  try {
    const feedbackId = asTrimmed(req.body?.feedbackId);
    const text = asTrimmed(req.body?.text);

    if (!feedbackId || !text) {
      return res.status(400).json({ message: '??????? ??? ???? ???? ??????.' });
    }

    const existing = await Feedback.findById(feedbackId).lean();
    if (!existing) {
      return res.status(404).json({ message: '??????? ??????? ??? ??????.' });
    }

    if (String(existing.studentId) !== String(req.user.id)) {
      return res.status(403).json({ message: '????? ???? ??? ??????? ?????? ?? ???.' });
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
    return res.status(500).json({ message: error.message || '???? ????? ????.' });
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


