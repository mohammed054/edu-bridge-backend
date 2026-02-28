
const mongoose = require('mongoose');
const ClassModel = require('../models/Class');
const Feedback = require('../models/Feedback');
const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');
const { sendServerError } = require('../utils/safeError');
const { HIKMAH_SUBJECTS } = require('../constants/subjects');
const { FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_KEYS, FEEDBACK_CATEGORY_LABEL_BY_KEY } = require('../constants/feedbackCatalog');
const { normalizeSelections, generateStudentFeedbackDraft, rewriteFeedbackMessage } = require('../services/studentFeedbackAiService');
const { buildStudentAiSignals } = require('../services/intelligenceService');
const { createNotification } = require('../services/notificationService');

const asTrimmed = (v) => String(v || '').trim();
const isValidObjectId = (v) => mongoose.Types.ObjectId.isValid(asTrimmed(v));
const normalizeList = (v) => (Array.isArray(v) ? [...new Set(v.map((i) => asTrimmed(i)).filter(Boolean))] : []);
const normalizeCategories = (v) => normalizeList(v).map((i) => i.toLowerCase()).filter((i) => FEEDBACK_CATEGORY_KEYS.includes(i));
const normalizeCategoryDetails = (value = {}) => {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value).reduce((acc, [key, list]) => {
    const cleanKey = asTrimmed(key).toLowerCase();
    if (!cleanKey) return acc;
    acc[cleanKey] = normalizeList(list);
    return acc;
  }, {});
};
const flattenTags = (details) => [...new Set(Object.values(details || {}).flatMap((list) => normalizeList(list)))];
const hasSubjectAccess = (subjects, subject) => !subject || (subjects || []).some((s) => String(s || '').toLowerCase() === String(subject).toLowerCase());

const mapFeedbackResponse = (item) => ({
  id: String(item._id),
  _id: String(item._id),
  feedbackType: item.feedbackType || '',
  studentId: item.studentId ? String(item.studentId) : '',
  studentName: item.studentName || '',
  className: item.className || '',
  teacherId: item.teacherId ? String(item.teacherId) : '',
  teacherName: item.teacherName || '',
  adminId: item.adminId ? String(item.adminId) : '',
  adminName: item.adminName || '',
  senderId: item.senderId ? String(item.senderId) : '',
  senderRole: item.senderRole || item.senderType || '',
  receiverId: item.receiverId ? String(item.receiverId) : '',
  receiverRole: item.receiverRole || '',
  subject: item.subject || '',
  category: item.category || '',
  subcategory: item.subcategory || '',
  categories: item.categories || [],
  categoryDetails: item.categoryDetails || {},
  notes: item.notes || '',
  suggestion: item.suggestion || '',
  tags: item.tags || [],
  urgency: item.urgency || 'low',
  trendFlags: item.trendFlags || [],
  aiGenerated: item.aiGenerated === true,
  aiLabel: item.aiLabel || '',
  aiUpdatedAt: item.aiUpdatedAt || null,
  aiSummary: item.aiSummary || {},
  visualSummary: item.visualSummary || {},
  message: item.message || item.content || item.text || '',
  content: item.content || item.message || item.text || '',
  text: item.text || item.message || item.content || '',
  AIAnalysis: item.AIAnalysis || {},
  workflowStatus: item.workflowStatus || 'sent',
  reviewedBy: item.reviewedBy ? String(item.reviewedBy) : '',
  reviewedByRole: item.reviewedByRole || '',
  reviewedAt: item.reviewedAt || null,
  reviewAction: item.reviewAction || '',
  reviewNote: item.reviewNote || '',
  clarificationRequest: item.clarificationRequest || '',
  parentFeedbackId: item.parentFeedbackId ? String(item.parentFeedbackId) : '',
  followUpOwnerId: item.followUpOwnerId ? String(item.followUpOwnerId) : '',
  followUpOwnerName: item.followUpOwnerName || '',
  statusTimeline: (item.statusTimeline || []).map((entry) => ({
    status: entry.status || '',
    actorRole: entry.actorRole || '',
    actorId: entry.actorId ? String(entry.actorId) : '',
    note: entry.note || '',
    createdAt: entry.createdAt || null,
  })),
  replies: (item.replies || []).map((reply) => ({ senderType: reply.senderType || '', text: reply.text || '', createdAt: reply.createdAt || null })),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const applyRoleScope = (query, user) => {
  if (user.role === 'admin') return query;
  if (user.role === 'student') return { $and: [query, { $or: [{ studentId: user.id }, { senderId: user.id }, { receiverId: user.id }] }] };
  if (user.role === 'teacher') {
    const teacherScope = { $or: [{ teacherId: user.id }, { senderId: user.id }, { receiverId: user.id }] };
    if (!(user.subjects || []).length) return { $and: [query, teacherScope] };
    return { $and: [query, teacherScope, { $or: [{ subject: { $in: user.subjects } }, { subject: '' }, { subject: null }] }] };
  }
  if (user.role === 'parent') {
    const linked = (user.linkedStudentIds || []).filter((id) => isValidObjectId(id));
    return { $and: [query, { $or: [{ senderId: user.id }, { receiverId: user.id }, ...(linked.length ? [{ studentId: { $in: linked } }] : [])] }] };
  }
  return query;
};

const buildFallbackMessage = (studentName, subject, categories, notes) => {
  const labels = categories.map((key) => FEEDBACK_CATEGORY_LABEL_BY_KEY[key]).filter(Boolean);
  return `Update regarding ${studentName} in ${subject}: ${labels.join(', ') || 'general note'}.${notes ? ` Note: ${notes}.` : ''}`.trim();
};

const aiPlaceholder = ({ categories, categoryDetails, notes, status = 'placeholder' }) => ({ status, categories, categoryDetails, notes, updatedAt: new Date().toISOString() });

const appendWorkflowStatus = ({
  feedback,
  status,
  actorRole,
  actorId,
  note = '',
}) => {
  if (!feedback || !status || !actorRole) {
    return feedback;
  }

  feedback.workflowStatus = status;
  feedback.statusTimeline = Array.isArray(feedback.statusTimeline)
    ? feedback.statusTimeline
    : [];
  feedback.statusTimeline.push({
    status,
    actorRole,
    actorId: actorId || null,
    note: asTrimmed(note),
    createdAt: new Date(),
  });
  return feedback;
};

const toStudentDraftPayload = (draft = {}) => {
  const subjectLine = asTrimmed(
    draft?.subjectLine ||
      draft?.summary?.subjectLine ||
      draft?.title ||
      'Structured Student Feedback'
  );
  const body = asTrimmed(draft?.message || draft?.body || draft?.content || '');
  const suggestedAction = asTrimmed(
    draft?.suggestedAction ||
      draft?.actionLine ||
      draft?.summary?.actionItems?.[0] ||
      ''
  );
  return {
    subjectLine,
    body,
    suggestedAction,
  };
};

const parseFeedbackTypes = (query) => {
  const raw = asTrimmed(query.feedbackType || query.type);
  return raw ? [...new Set(raw.split(',').map((i) => i.trim()).filter(Boolean))] : [];
};

const resolveStudentRecipient = async ({ student, recipientRole, recipientId, subject, className }) => {
  const resolvedClassName = className || (student.classes || [])[0] || '';
  const classItem = resolvedClassName ? await ClassModel.findOne({ name: resolvedClassName }) : null;
  if (recipientRole === 'teacher') {
    const teacher = await User.findOne(recipientId ? { _id: recipientId, role: 'teacher' } : { role: 'teacher', classes: resolvedClassName, ...(subject ? { $or: [{ subject }, { subjects: subject }] } : {}) }).sort({ createdAt: 1 });
    if (!teacher) throw new Error('Teacher recipient not found.');
    if (!hasSubjectAccess(teacher.subject ? [teacher.subject] : teacher.subjects || [], subject)) throw new Error('Teacher does not teach this subject.');
    return { receiverId: teacher._id, receiverRole: 'teacher', teacherId: teacher._id, teacherName: teacher.name, adminId: null, adminName: '', className: resolvedClassName, classId: classItem?._id || null, recipientName: teacher.name };
  }
  if (recipientRole === 'admin') {
    const admin = await User.findOne(recipientId ? { _id: recipientId, role: 'admin' } : { role: 'admin' }).sort({ createdAt: 1 });
    if (!admin) throw new Error('Admin recipient not found.');
    return { receiverId: admin._id, receiverRole: 'admin', teacherId: null, teacherName: '', adminId: admin._id, adminName: admin.name || admin.username || 'Admin', className: resolvedClassName, classId: classItem?._id || null, recipientName: admin.name || admin.username || 'Admin' };
  }
  const parent = await User.findOne(recipientId ? { _id: recipientId, role: 'parent', linkedStudentIds: student._id } : { role: 'parent', linkedStudentIds: student._id }).sort({ createdAt: 1 });
  if (!parent) throw new Error('Parent recipient not found.');
  return { receiverId: parent._id, receiverRole: 'parent', teacherId: null, teacherName: '', adminId: null, adminName: '', className: resolvedClassName, classId: classItem?._id || null, recipientName: parent.name };
};

const createStudentMessageRecord = async ({ student, recipient, feedbackType, subject, categories, categoryDetails, subcategory, notes, message, suggestion, aiPayload }) => {
  return Feedback.create({
    studentId: student._id,
    studentName: student.name,
    classId: recipient.classId,
    className: recipient.className,
    teacherId: recipient.teacherId,
    teacherName: recipient.teacherName,
    adminId: recipient.adminId,
    adminName: recipient.adminName,
    senderId: student._id,
    senderRole: 'student',
    senderType: 'student',
    receiverId: recipient.receiverId,
    receiverRole: recipient.receiverRole,
    feedbackType,
    subject,
    category: categories[0],
    subcategory,
    categories,
    categoryDetails,
    tags: flattenTags(categoryDetails),
    notes,
    suggestion,
    text: message,
    message,
    content: message,
    aiGenerated: aiPayload.aiGenerated,
    aiLabel: aiPayload.aiGenerated ? 'AI-generated draft' : '',
    aiUpdatedAt: aiPayload.aiGenerated ? new Date() : null,
    urgency: aiPayload.urgency,
    trendFlags: aiPayload.trendFlags,
    aiSummary: aiPayload.aiSummary,
    visualSummary: aiPayload.visualSummary,
    AIAnalysis: aiPayload.AIAnalysis,
    workflowStatus: 'sent',
    statusTimeline: [
      {
        status: 'sent',
        actorRole: 'student',
        actorId: student._id,
        note: '',
        createdAt: new Date(),
      },
    ],
    timestamp: new Date(),
  });
};
const buildAiPayload = (body = {}, fallback = {}) => {
  const draft = body.aiDraft && typeof body.aiDraft === 'object' ? body.aiDraft : fallback;
  const trend = draft?.trendAnalysis || {};
  const summary = draft?.summary || {};
  return {
    aiGenerated: Boolean(draft?.message),
    urgency: ['low', 'medium', 'high'].includes(asTrimmed(trend?.urgency).toLowerCase()) ? asTrimmed(trend.urgency).toLowerCase() : 'low',
    trendFlags: normalizeList(trend?.flags || []),
    aiSummary: {
      summary,
      trendAnalysis: trend,
      actionItems: normalizeList(summary?.actionItems || []),
      selectedItems: Array.isArray(draft?.selectedItems) ? draft.selectedItems : [],
      engine: asTrimmed(draft?.engine || body.aiEngine || ''),
    },
    visualSummary: draft?.visualSummary && typeof draft.visualSummary === 'object' ? draft.visualSummary : {},
    AIAnalysis: aiPlaceholder({
      categories: normalizeCategories(draft?.categories || body.categories || []),
      categoryDetails: normalizeCategoryDetails(draft?.categoryDetails || body.categoryDetails || {}),
      notes: asTrimmed(body.notes || ''),
      status: draft?.message ? 'generated' : 'placeholder',
    }),
  };
};

const getFeedbackOptions = async (req, res) => {
  try {
    let allowedClasses = null;
    if (req.user.role === 'teacher') {
      allowedClasses = req.user.classes?.length ? req.user.classes : [];
    } else if (req.user.role === 'student') {
      const currentStudent = await User.findOne({ _id: req.user.id, role: 'student' }, { classes: 1 }).lean();
      allowedClasses = currentStudent?.classes?.length ? currentStudent.classes : [];
    } else if (req.user.role === 'parent') {
      const linkedStudents = (req.user.linkedStudentIds || []).length
        ? await User.find({ _id: { $in: req.user.linkedStudentIds }, role: 'student' }, { classes: 1 }).lean()
        : [];
      allowedClasses = [...new Set(linkedStudents.flatMap((item) => item.classes || []))];
    }

    const classQuery = req.user.role === 'admin' ? {} : allowedClasses?.length ? { name: { $in: allowedClasses } } : { _id: null };
    const studentQuery = req.user.role === 'student'
      ? { _id: req.user.id, role: 'student' }
      : req.user.role === 'teacher' || req.user.role === 'parent'
        ? { role: 'student', classes: { $in: allowedClasses || [] } }
        : { role: 'student' };
    const teacherQuery = req.user.role === 'admin' ? { role: 'teacher' } : { role: 'teacher', classes: { $in: allowedClasses || [] } };
    const parentQuery = req.user.role === 'admin'
      ? { role: 'parent' }
      : req.user.role === 'student'
        ? { role: 'parent', linkedStudentIds: req.user.id }
        : req.user.role === 'teacher'
          ? { role: 'parent' }
          : { _id: req.user.id, role: 'parent' };

    const [classes, students, teachers, admins, parents] = await Promise.all([
      ClassModel.find(classQuery).sort({ createdAt: 1 }).lean(),
      User.find(studentQuery, { name: 1, email: 1, classes: 1, profilePicture: 1, avatarUrl: 1 }).sort({ name: 1 }).lean(),
      User.find(teacherQuery, { name: 1, email: 1, classes: 1, subject: 1, subjects: 1, profilePicture: 1, avatarUrl: 1 }).sort({ name: 1 }).lean(),
      User.find({ role: 'admin' }, { name: 1, username: 1, email: 1, profilePicture: 1, avatarUrl: 1 }).lean(),
      User.find(parentQuery, { name: 1, email: 1, linkedStudentIds: 1, profilePicture: 1, avatarUrl: 1 }).sort({ name: 1 }).lean(),
    ]);

    const classPayload = classes.map((item) => ({
      id: String(item._id),
      name: item.name,
      grade: item.grade,
      section: item.section,
      students: students.filter((student) => (student.classes || []).includes(item.name)).map((student) => ({ id: String(student._id), name: student.name, avatarUrl: student.profilePicture || student.avatarUrl || '' })),
      teachers: teachers.filter((teacher) => (teacher.classes || []).includes(item.name)).map((teacher) => ({ id: String(teacher._id), name: teacher.name, avatarUrl: teacher.profilePicture || teacher.avatarUrl || '', subjects: teacher.subject ? [teacher.subject] : teacher.subjects || [], subject: teacher.subject || teacher.subjects?.[0] || '' })),
    }));

    return res.json({
      classes: classPayload,
      admins: admins.map((admin) => ({ id: String(admin._id), name: admin.name || admin.username || 'Admin', avatarUrl: admin.profilePicture || admin.avatarUrl || '' })),
      parents: parents.map((parent) => ({ id: String(parent._id), name: parent.name || parent.email || 'Parent', email: parent.email || '', linkedStudentIds: (parent.linkedStudentIds || []).map((id) => String(id)), avatarUrl: parent.profilePicture || parent.avatarUrl || '' })),
      categories: FEEDBACK_CATEGORIES,
      subjects: req.user.role === 'teacher' ? req.user.subjects || [] : HIKMAH_SUBJECTS,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load feedback options.');
  }
};

const generateFeedback = async (req, res) => {
  try {
    const subject = asTrimmed(req.body?.subject);
    const categories = normalizeCategories(req.body?.categories || []);
    const categoryDetails = normalizeCategoryDetails(req.body?.categoryDetails || {});
    const notes = asTrimmed(req.body?.notes);
    const content = asTrimmed(req.body?.content);
    const suggestion = asTrimmed(req.body?.suggestion);
    const subcategory = asTrimmed(req.body?.subcategory);
    const studentRef = asTrimmed(req.body?.studentId);
    const studentName = asTrimmed(req.body?.studentName);

    if (!subject || !categories.length || (!studentRef && !studentName)) {
      return res.status(400).json({ message: 'Student, subject, and categories are required.' });
    }

    let student = null;
    if (studentRef) {
      if (!isValidObjectId(studentRef)) return res.status(400).json({ message: 'Student identifier is invalid.' });
      student = await User.findOne({ _id: studentRef, role: 'student' });
    } else {
      student = await User.findOne({ role: 'student', name: new RegExp(`^${studentName}$`, 'i') });
    }
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    const className = asTrimmed(req.body?.className) || (student.classes || [])[0] || '';
    const targetClass = className ? await ClassModel.findOne({ name: className }) : null;
    if (!targetClass) return res.status(400).json({ message: 'Student class not found.' });
    if (req.user.role === 'teacher' && req.user.classes?.length && !req.user.classes.includes(targetClass.name)) return res.status(403).json({ message: 'Class access denied.' });
    if (req.user.role === 'teacher' && !hasSubjectAccess(req.user.subjects || [], subject)) return res.status(403).json({ message: 'Subject access denied.' });

    const senderRole = req.user.role === 'admin' ? 'admin' : 'teacher';
    const message = content || buildFallbackMessage(student.name, subject, categories, notes);
    const created = await Feedback.create({
      studentId: student._id,
      studentName: student.name,
      classId: targetClass._id,
      className: targetClass.name,
      teacherId: senderRole === 'teacher' ? req.user.id : null,
      teacherName: senderRole === 'teacher' ? req.user.name || 'Teacher' : '',
      adminId: senderRole === 'admin' ? req.user.id : null,
      adminName: senderRole === 'admin' ? req.user.name || 'Admin' : '',
      senderId: req.user.id,
      senderRole,
      senderType: senderRole,
      receiverId: student._id,
      receiverRole: 'student',
      feedbackType: senderRole === 'admin' ? 'admin_feedback' : 'teacher_feedback',
      subject,
      category: categories[0],
      subcategory,
      categories,
      categoryDetails,
      tags: flattenTags(categoryDetails),
      notes,
      suggestion,
      text: message,
      message,
      content: message,
      aiGenerated: true,
      AIAnalysis: aiPlaceholder({ categories, categoryDetails, notes, status: 'generated' }),
      urgency: 'low',
      trendFlags: [],
      aiSummary: {},
      visualSummary: {},
      timestamp: new Date(),
    });

    await User.updateOne({ _id: student._id }, { $addToSet: { feedbackHistory: created._id } });
    return res.status(201).json({ message, feedback: mapFeedbackResponse(created) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to generate feedback.');
  }
};
const sendStudentFeedbackCore = async ({ req, recipientRole, recipientId, explicitFeedbackType = '' }) => {
  const subject = asTrimmed(req.body?.subject);
  const notes = asTrimmed(req.body?.notes || req.body?.optionalText);
  const suggestion = asTrimmed(req.body?.suggestion || req.body?.actionLine || req.body?.suggestedAction);
  const subcategory = asTrimmed(req.body?.subcategory);
  const className = asTrimmed(req.body?.className);
  if (!subject) throw new Error('Subject is required.');

  const selectedItems = normalizeSelections({
    selectedCategories: req.body?.selectedCategories || req.body?.selections || req.body?.categories || [],
    categoryDetails: req.body?.categoryDetails || req.body?.aiDraft?.categoryDetails || {},
  });
  if (!selectedItems.length) throw new Error('At least one feedback option must be selected.');

  const categories = normalizeCategories(selectedItems.map((item) => item.category));
  const categoryDetails = normalizeCategoryDetails(req.body?.categoryDetails || selectedItems.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    if (item.option) acc[item.category].push(item.option);
    return acc;
  }, {}));

  if (!categories.length) throw new Error('No valid categories detected.');

  const student = await User.findOne({ _id: req.user.id, role: 'student' }, { name: 1, classes: 1 }).lean();
  if (!student) throw new Error('Student account not found.');

  const recipient = await resolveStudentRecipient({ student, recipientRole, recipientId, subject, className });

  let message = asTrimmed(req.body?.message || req.body?.content || req.body?.body || req.body?.aiDraft?.body);
  let aiDraft = req.body?.aiDraft && typeof req.body.aiDraft === 'object' ? req.body.aiDraft : null;

  if (!message || !aiDraft) {
    const recentFeedback = await Feedback.find({ studentId: student._id }, { category: 1, subject: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(50).lean();
    const signals = await buildStudentAiSignals(student._id, { subject });
    const surveys = await Survey.find({ isActive: true, $or: [{ audience: { $size: 0 } }, { audience: { $in: ['student'] } }, { assignedUserIds: student._id }] }, { _id: 1 }).lean();
    const responses = surveys.length ? await SurveyResponse.countDocuments({ surveyId: { $in: surveys.map((s) => s._id) }, respondentId: student._id, respondentRole: 'student' }) : 0;
    aiDraft = await generateStudentFeedbackDraft({ studentName: student.name, recipientRole, subject, selectedCategories: selectedItems, categoryDetails, notes, tone: req.body?.tone || 'constructive', recentFeedback, signals: { ...signals, pendingSurveyCount: Math.max(0, surveys.length - responses) } });
  }

  if (!message) {
    message = asTrimmed(aiDraft?.message || aiDraft?.body) || buildFallbackMessage(student.name, subject, categories, notes);
  }
  const aiPayload = buildAiPayload(req.body, aiDraft || {});

  const feedback = await createStudentMessageRecord({
    student,
    recipient,
    feedbackType: explicitFeedbackType || (recipient.receiverRole === 'teacher' ? 'student_to_teacher' : recipient.receiverRole === 'admin' ? 'student_to_admin' : 'student_to_parent'),
    subject,
    categories,
    categoryDetails,
    subcategory,
    notes,
    message,
    suggestion,
    aiPayload,
  });

  await createNotification({
    recipientId: recipient.receiverId,
    recipientRole: recipient.receiverRole,
    category: 'feedback',
    urgency: aiPayload.urgency || 'low',
    title: `New student feedback: ${student.name}`,
    body: message.slice(0, 280),
    link:
      recipient.receiverRole === 'teacher'
        ? '/teacher'
        : recipient.receiverRole === 'admin'
          ? '/admin/feedback'
          : '/student',
    sourceType: 'feedback',
    sourceId: String(feedback._id),
    metadata: {
      studentId: String(student._id),
      className: recipient.className || '',
      subject,
      categories,
    },
  });

  return feedback;
};

const submitStudentToTeacherFeedback = async (req, res) => {
  try {
    const feedback = await sendStudentFeedbackCore({ req, recipientRole: 'teacher', recipientId: req.body?.teacherId, explicitFeedbackType: 'student_to_teacher' });
    return res.status(201).json({ feedback: mapFeedbackResponse(feedback) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to submit student feedback to teacher.');
  }
};

const submitStudentToAdminFeedback = async (req, res) => {
  try {
    const feedback = await sendStudentFeedbackCore({ req, recipientRole: 'admin', recipientId: req.body?.adminId, explicitFeedbackType: 'student_to_admin' });
    return res.status(201).json({ feedback: mapFeedbackResponse(feedback) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to submit student feedback to admin.');
  }
};

const submitStudentToParentFeedback = async (req, res) => {
  try {
    const feedback = await sendStudentFeedbackCore({ req, recipientRole: 'parent', recipientId: req.body?.parentId || req.body?.recipientId, explicitFeedbackType: 'student_to_parent' });
    return res.status(201).json({ feedback: mapFeedbackResponse(feedback) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to submit student feedback to parent.');
  }
};

const previewStudentAiFeedback = async (req, res) => {
  try {
    const recipientRole = asTrimmed(req.body?.recipientRole || req.body?.target || 'teacher').toLowerCase();
    const recipientId = asTrimmed(req.body?.recipientId || req.body?.teacherId || req.body?.parentId || req.body?.adminId);
    const subject = asTrimmed(req.body?.subject);
    const notes = asTrimmed(req.body?.notes || req.body?.optionalText);
    const className = asTrimmed(req.body?.className);
    if (!['teacher', 'admin', 'parent'].includes(recipientRole)) return res.status(400).json({ message: 'Recipient role must be teacher, parent, or admin.' });
    if (!subject) return res.status(400).json({ message: 'Subject is required.' });

    const selections = normalizeSelections({ selectedCategories: req.body?.selectedCategories || req.body?.selections || [], categoryDetails: req.body?.categoryDetails || {} });
    if (!selections.length) return res.status(400).json({ message: 'At least one feedback option must be selected.' });

    const student = await User.findOne({ _id: req.user.id, role: 'student' }, { name: 1, classes: 1 }).lean();
    if (!student) return res.status(404).json({ message: 'Student account not found.' });

    const recipient = await resolveStudentRecipient({ student, recipientRole, recipientId, subject, className });
    const recentFeedback = await Feedback.find({ studentId: student._id }, { category: 1, subject: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(50).lean();
    const signals = await buildStudentAiSignals(student._id, { subject });
    const surveys = await Survey.find({ isActive: true, $or: [{ audience: { $size: 0 } }, { audience: { $in: ['student'] } }, { assignedUserIds: student._id }] }, { _id: 1 }).lean();
    const responses = surveys.length ? await SurveyResponse.countDocuments({ surveyId: { $in: surveys.map((s) => s._id) }, respondentId: student._id, respondentRole: 'student' }) : 0;

    const draft = await generateStudentFeedbackDraft({ studentName: student.name, recipientRole, subject, selectedCategories: selections, categoryDetails: {}, notes, tone: req.body?.tone || 'constructive', recentFeedback, signals: { ...signals, pendingSurveyCount: Math.max(0, surveys.length - responses) } });
    const structured = toStudentDraftPayload(draft);
    return res.json({
      editable: true,
      recipient: { role: recipient.receiverRole, id: String(recipient.receiverId), name: recipient.recipientName },
      subject,
      className: recipient.className,
      tone: req.body?.tone || 'constructive',
      aiLabel: 'AI-generated draft',
      aiUpdatedAt: new Date().toISOString(),
      draft: {
        ...draft,
        ...structured,
        trendAnalysis: {
          ...(draft.trendAnalysis || {}),
          pendingSurveys: Math.max(0, surveys.length - responses),
          surveyAssigned: surveys.length,
        },
      },
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to preview AI feedback.');
  }
};

const sendStudentAiFeedback = async (req, res) => {
  try {
    const recipientRole = asTrimmed(req.body?.recipientRole || req.body?.target || 'teacher').toLowerCase();
    const recipientId = asTrimmed(req.body?.recipientId || req.body?.teacherId || req.body?.parentId || req.body?.adminId);
    if (!['teacher', 'admin', 'parent'].includes(recipientRole)) return res.status(400).json({ message: 'Recipient role must be teacher, parent, or admin.' });
    const feedback = await sendStudentFeedbackCore({ req, recipientRole, recipientId });
    return res.status(201).json({ feedback: mapFeedbackResponse(feedback) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to send AI feedback.');
  }
};

const rewriteStudentFeedback = async (req, res) => {
  try {
    const text = asTrimmed(req.body?.text);
    if (!text) return res.status(400).json({ message: 'Text is required for rewrite.' });
    const rewritten = await rewriteFeedbackMessage({ text, tone: req.body?.tone || 'constructive' });
    return res.json(rewritten);
  } catch (error) {
    return sendServerError(res, error, 'Failed to rewrite feedback message.');
  }
};
const listFeedbacks = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const feedbackTypes = parseFeedbackTypes(req.query);
    const query = {};

    if (asTrimmed(req.query.studentId) && isValidObjectId(req.query.studentId)) query.studentId = asTrimmed(req.query.studentId);
    if (asTrimmed(req.query.teacherId) && isValidObjectId(req.query.teacherId)) query.teacherId = asTrimmed(req.query.teacherId);
    if (asTrimmed(req.query.adminId) && isValidObjectId(req.query.adminId)) query.adminId = asTrimmed(req.query.adminId);
    if (asTrimmed(req.query.className)) query.className = asTrimmed(req.query.className);
    if (asTrimmed(req.query.subject)) query.subject = asTrimmed(req.query.subject);
    if (asTrimmed(req.query.senderRole)) query.senderRole = asTrimmed(req.query.senderRole);
    if (asTrimmed(req.query.receiverRole)) query.receiverRole = asTrimmed(req.query.receiverRole);
    if (asTrimmed(req.query.urgency)) query.urgency = asTrimmed(req.query.urgency).toLowerCase();
    if (asTrimmed(req.query.workflowStatus)) {
      const statuses = normalizeList(String(req.query.workflowStatus).split(','))
        .map((entry) => entry.toLowerCase())
        .filter((entry) => ['draft', 'sent', 'reviewed', 'rejected', 'clarification_requested', 'forwarded'].includes(entry));
      if (statuses.length === 1) query.workflowStatus = statuses[0];
      else if (statuses.length > 1) query.workflowStatus = { $in: statuses };
    }

    const categoryFilter = normalizeCategories(String(req.query.category || '').split(','));
    if (categoryFilter.length === 1) query.category = categoryFilter[0];
    else if (categoryFilter.length > 1) query.category = { $in: categoryFilter };

    if (feedbackTypes.length === 1) query.feedbackType = feedbackTypes[0];
    else if (feedbackTypes.length > 1) query.feedbackType = { $in: feedbackTypes };

    const searchText = asTrimmed(req.query.search);
    if (searchText) {
      const pattern = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
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
    return res.json({ feedbacks: feedbacks.map(mapFeedbackResponse) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load feedback list.');
  }
};

const addFeedbackComment = async (req, res) => {
  try {
    const feedbackId = asTrimmed(req.body?.feedbackId || req.params?.id);
    const text = asTrimmed(req.body?.text);
    if (!feedbackId || !text) return res.status(400).json({ message: 'Feedback identifier and text are required.' });
    if (!isValidObjectId(feedbackId)) return res.status(400).json({ message: 'Feedback identifier is invalid.' });

    const existing = await Feedback.findById(feedbackId).lean();
    if (!existing) return res.status(404).json({ message: 'Feedback record not found.' });

    const linked = (req.user.linkedStudentIds || []).map((id) => String(id));
    const allowed = req.user.role === 'admin' || String(existing.senderId) === String(req.user.id) || String(existing.receiverId) === String(req.user.id) || String(existing.studentId) === String(req.user.id) || linked.includes(String(existing.studentId));
    if (!allowed) return res.status(403).json({ message: 'You are not allowed to comment on this feedback.' });

    const updated = await Feedback.findByIdAndUpdate(feedbackId, { $push: { replies: { senderType: req.user.role, text, createdAt: new Date() } } }, { new: true }).lean();
    return res.json({ feedback: mapFeedbackResponse(updated) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to post feedback comment.');
  }
};

const addReply = async (req, res) => addFeedbackComment(req, res);

const listTeacherReviewQueue = async (req, res) => {
  try {
    const className = asTrimmed(req.query?.className);
    const urgency = asTrimmed(req.query?.urgency).toLowerCase();
    const category = asTrimmed(req.query?.category).toLowerCase();
    const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 1), 500);

    if (className && !req.user.classes?.includes(className)) {
      return res.status(403).json({ message: 'Class access denied.' });
    }

    const query = {
      feedbackType: 'student_to_teacher',
      receiverId: req.user.id,
      workflowStatus: { $in: ['sent', 'clarification_requested', 'draft'] },
    };

    if (className) query.className = className;
    if (['low', 'medium', 'high'].includes(urgency)) query.urgency = urgency;
    if (FEEDBACK_CATEGORY_KEYS.includes(category)) query.category = category;

    const docs = await Feedback.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    const items = docs
      .filter((item) => hasSubjectAccess(req.user.subjects || [], item.subject || ''))
      .map(mapFeedbackResponse);

    return res.json({ queue: items });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load teacher review queue.');
  }
};

const reviewTeacherDraft = async (req, res) => {
  try {
    const feedbackId = asTrimmed(req.params?.id || req.body?.feedbackId);
    const action = asTrimmed(req.body?.action).toLowerCase();
    const note = asTrimmed(req.body?.note);
    const clarificationRequest = asTrimmed(req.body?.clarificationRequest || req.body?.note);
    const tone = asTrimmed(req.body?.tone);
    const customMessage = asTrimmed(req.body?.message || req.body?.content);

    if (!isValidObjectId(feedbackId)) {
      return res.status(400).json({ message: 'Feedback identifier is invalid.' });
    }
    if (!['accept', 'edit', 'reject', 'clarify'].includes(action)) {
      return res.status(400).json({ message: 'Review action is invalid.' });
    }

    const feedback = await Feedback.findOne({
      _id: feedbackId,
      feedbackType: 'student_to_teacher',
      receiverId: req.user.id,
    });

    if (!feedback) {
      return res.status(404).json({ message: 'Feedback draft not found.' });
    }

    if (!hasSubjectAccess(req.user.subjects || [], feedback.subject || '')) {
      return res.status(403).json({ message: 'Subject access denied.' });
    }

    feedback.reviewedBy = req.user.id;
    feedback.reviewedByRole = 'teacher';
    feedback.reviewedAt = new Date();
    feedback.reviewAction = action;
    feedback.reviewNote = note;

    let parentFeedback = null;

    if (action === 'reject') {
      appendWorkflowStatus({
        feedback,
        status: 'rejected',
        actorRole: 'teacher',
        actorId: req.user.id,
        note: note || 'Rejected by teacher.',
      });
    } else if (action === 'clarify') {
      feedback.clarificationRequest = clarificationRequest || 'Please clarify the submitted feedback.';
      appendWorkflowStatus({
        feedback,
        status: 'clarification_requested',
        actorRole: 'teacher',
        actorId: req.user.id,
        note: feedback.clarificationRequest,
      });
    } else {
      let forwardMessage = customMessage || feedback.message || feedback.content || feedback.text || '';
      if ((action === 'edit' || tone) && forwardMessage) {
        try {
          const rewritten = await rewriteFeedbackMessage({
            text: forwardMessage,
            tone: tone || 'constructive',
          });
          forwardMessage = asTrimmed(rewritten?.rewrittenText) || forwardMessage;
        } catch {
          // Ignore rewrite failures and keep manual text.
        }
      }

      const parent = await User.findOne(
        {
          role: 'parent',
          linkedStudentIds: feedback.studentId,
          isActive: { $ne: false },
        },
        { _id: 1, name: 1 }
      ).lean();

      if (parent) {
        parentFeedback = await Feedback.create({
          studentId: feedback.studentId,
          studentName: feedback.studentName,
          classId: feedback.classId || null,
          className: feedback.className || '',
          teacherId: req.user.id,
          teacherName: req.user.name || 'Teacher',
          adminId: null,
          adminName: '',
          senderId: req.user.id,
          senderRole: 'teacher',
          senderType: 'teacher',
          receiverId: parent._id,
          receiverRole: 'parent',
          feedbackType: 'teacher_feedback',
          subject: feedback.subject || '',
          category: feedback.category || FEEDBACK_CATEGORY_KEYS[0],
          subcategory: feedback.subcategory || '',
          categories: feedback.categories || [feedback.category].filter(Boolean),
          categoryDetails: feedback.categoryDetails || {},
          tags: feedback.tags || [],
          notes: feedback.notes || '',
          suggestion: feedback.suggestion || '',
          text: forwardMessage,
          message: forwardMessage,
          content: forwardMessage,
          aiGenerated: feedback.aiGenerated === true,
          aiLabel: feedback.aiGenerated ? 'AI-generated draft (teacher reviewed)' : '',
          aiUpdatedAt: feedback.aiGenerated ? new Date() : null,
          urgency: feedback.urgency || 'low',
          trendFlags: feedback.trendFlags || [],
          aiSummary: feedback.aiSummary || {},
          visualSummary: feedback.visualSummary || {},
          AIAnalysis: feedback.AIAnalysis || {},
          workflowStatus: 'sent',
          statusTimeline: [
            {
              status: 'sent',
              actorRole: 'teacher',
              actorId: req.user.id,
              note: action === 'edit' ? 'Edited by teacher before forwarding.' : 'Approved and forwarded by teacher.',
              createdAt: new Date(),
            },
          ],
          timestamp: new Date(),
        });

        await createNotification({
          recipientId: parent._id,
          recipientRole: 'parent',
          category: 'feedback',
          urgency: feedback.urgency || 'medium',
          title: `New teacher feedback: ${feedback.studentName || 'Student'}`,
          body: forwardMessage.slice(0, 280),
          link: '/parent',
          sourceType: 'feedback',
          sourceId: String(parentFeedback._id),
          metadata: {
            studentId: String(feedback.studentId),
            className: feedback.className || '',
            subject: feedback.subject || '',
          },
        });
      }

      feedback.parentFeedbackId = parentFeedback?._id || null;
      appendWorkflowStatus({
        feedback,
        status: 'reviewed',
        actorRole: 'teacher',
        actorId: req.user.id,
        note: action === 'edit' ? 'Edited and reviewed.' : 'Reviewed and accepted.',
      });
    }

    await feedback.save();

    await createNotification({
      recipientId: feedback.studentId,
      recipientRole: 'student',
      category: 'feedback',
      urgency: feedback.urgency || 'medium',
      title: 'Your feedback has been reviewed',
      body:
        action === 'clarify'
          ? feedback.clarificationRequest || 'Teacher requested clarification.'
          : action === 'reject'
            ? 'Your feedback was reviewed and rejected.'
            : 'Your feedback was reviewed and forwarded.',
      link: '/student',
      sourceType: 'feedback',
      sourceId: String(feedback._id),
      metadata: {
        action,
      },
    });

    return res.json({
      feedback: mapFeedbackResponse(feedback.toObject()),
      parentFeedback: parentFeedback ? mapFeedbackResponse(parentFeedback.toObject()) : null,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to review feedback draft.');
  }
};

const assignFeedbackFollowUpOwner = async (req, res) => {
  try {
    const feedbackId = asTrimmed(req.params?.id || req.body?.feedbackId);
    const ownerId = asTrimmed(req.body?.ownerId);

    if (!isValidObjectId(feedbackId) || !isValidObjectId(ownerId)) {
      return res.status(400).json({ message: 'Feedback and owner identifiers are required.' });
    }

    const [feedback, owner] = await Promise.all([
      Feedback.findById(feedbackId),
      User.findOne({ _id: ownerId, role: { $in: ['admin', 'teacher'] } }, { _id: 1, name: 1, role: 1 }).lean(),
    ]);

    if (!feedback) {
      return res.status(404).json({ message: 'Feedback not found.' });
    }
    if (!owner) {
      return res.status(404).json({ message: 'Follow-up owner not found.' });
    }

    feedback.followUpOwnerId = owner._id;
    feedback.followUpOwnerName = owner.name || '';
    await feedback.save();

    await createNotification({
      recipientId: owner._id,
      recipientRole: owner.role,
      category: 'feedback',
      urgency: feedback.urgency || 'medium',
      title: 'New feedback follow-up assignment',
      body: `${feedback.studentName || 'Student'} · ${feedback.className || ''} · ${feedback.subject || ''}`,
      link: owner.role === 'admin' ? '/admin/feedback' : '/teacher',
      sourceType: 'feedback',
      sourceId: String(feedback._id),
      metadata: {
        studentId: String(feedback.studentId),
        className: feedback.className || '',
      },
    });

    return res.json({ feedback: mapFeedbackResponse(feedback.toObject()) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to assign follow-up owner.');
  }
};

const buildFeedbackAiSummaryText = ({ total, urgent, repeatedUrgent, highFrequency, attentionCount }) => {
  const lines = [
    `Total filtered feedback cases: ${total}.`,
    `Urgent cases: ${urgent}.`,
    `Students with repeated urgent flags: ${repeatedUrgent}.`,
    `Most frequent issue category: ${highFrequency || 'N/A'}.`,
    `Students currently needing attention: ${attentionCount}.`,
    'Advisory: Review high urgency and repeated cases first; all actions require human confirmation.',
  ];
  return lines.join(' ');
};

const listAdminFeedbackIntelligence = async (req, res) => {
  try {
    const className = asTrimmed(req.query?.className);
    const urgency = asTrimmed(req.query?.urgency).toLowerCase();
    const category = asTrimmed(req.query?.category).toLowerCase();
    const workflowStatus = asTrimmed(req.query?.workflowStatus).toLowerCase();
    const studentId = asTrimmed(req.query?.studentId);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 500, 1), 1500);

    const query = {
      feedbackType: { $in: ['student_to_teacher', 'student_to_admin'] },
    };
    if (className) query.className = className;
    if (['low', 'medium', 'high'].includes(urgency)) query.urgency = urgency;
    if (FEEDBACK_CATEGORY_KEYS.includes(category)) query.category = category;
    if (['draft', 'sent', 'reviewed', 'rejected', 'clarification_requested', 'forwarded'].includes(workflowStatus)) {
      query.workflowStatus = workflowStatus;
    }
    if (studentId && isValidObjectId(studentId)) query.studentId = studentId;

    const records = await Feedback.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    const mapped = records.map(mapFeedbackResponse);

    const urgentRecords = mapped.filter((item) => item.urgency === 'high');
    const repeatedUrgentByStudent = urgentRecords.reduce((acc, item) => {
      const key = item.studentId || '';
      if (!key) return acc;
      acc[key] = acc[key] || {
        studentId: item.studentId,
        studentName: item.studentName,
        className: item.className,
        count: 0,
      };
      acc[key].count += 1;
      return acc;
    }, {});

    const repeatedUrgentCases = Object.values(repeatedUrgentByStudent)
      .filter((item) => item.count >= 2)
      .sort((a, b) => b.count - a.count);

    const highFrequencyIssues = Object.entries(
      mapped.reduce((acc, item) => {
        const key = item.category || 'other';
        acc[key] = Number(acc[key] || 0) + 1;
        return acc;
      }, {})
    )
      .map(([categoryKey, count]) => ({
        category: categoryKey,
        label: FEEDBACK_CATEGORY_LABEL_BY_KEY[categoryKey] || categoryKey,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const attentionMap = mapped.reduce((acc, item) => {
      const key = item.studentId || '';
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = {
          studentId: item.studentId,
          studentName: item.studentName || '',
          className: item.className || '',
          score: 0,
          urgentCount: 0,
          mediumCount: 0,
          totalCount: 0,
        };
      }
      acc[key].totalCount += 1;
      if (item.urgency === 'high') {
        acc[key].urgentCount += 1;
        acc[key].score += 3;
      } else if (item.urgency === 'medium') {
        acc[key].mediumCount += 1;
        acc[key].score += 2;
      } else {
        acc[key].score += 1;
      }
      if (item.workflowStatus === 'clarification_requested') acc[key].score += 1;
      if (item.workflowStatus === 'sent') acc[key].score += 1;
      return acc;
    }, {});

    const studentsNeedingAttention = Object.values(attentionMap)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    const conversationHistory = studentId && isValidObjectId(studentId)
      ? mapped.filter((item) => item.studentId === studentId)
      : [];

    const aiSummary = {
      label: 'AI-generated insight (editable)',
      updatedAt: new Date().toISOString(),
      text: buildFeedbackAiSummaryText({
        total: mapped.length,
        urgent: urgentRecords.length,
        repeatedUrgent: repeatedUrgentCases.length,
        highFrequency: highFrequencyIssues[0]?.label || '',
        attentionCount: studentsNeedingAttention.length,
      }),
    };

    return res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        total: mapped.length,
        urgent: urgentRecords.length,
        sent: mapped.filter((item) => item.workflowStatus === 'sent').length,
        reviewed: mapped.filter((item) => item.workflowStatus === 'reviewed').length,
        clarificationRequested: mapped.filter((item) => item.workflowStatus === 'clarification_requested').length,
      },
      table: mapped,
      repeatedUrgentCases,
      highFrequencyIssues,
      studentsNeedingAttention,
      conversationHistory,
      aiSummary,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load feedback intelligence.');
  }
};

const escapeCsv = (value) => {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const exportAdminFeedbackIntelligence = async (req, res) => {
  try {
    const className = asTrimmed(req.query?.className);
    const urgency = asTrimmed(req.query?.urgency).toLowerCase();
    const category = asTrimmed(req.query?.category).toLowerCase();

    const query = {
      feedbackType: { $in: ['student_to_teacher', 'student_to_admin'] },
    };
    if (className) query.className = className;
    if (['low', 'medium', 'high'].includes(urgency)) query.urgency = urgency;
    if (FEEDBACK_CATEGORY_KEYS.includes(category)) query.category = category;

    const rows = await Feedback.find(query).sort({ createdAt: -1 }).limit(1500).lean();
    const mapped = rows.map(mapFeedbackResponse);

    const headers = [
      'feedbackId',
      'createdAt',
      'studentName',
      'className',
      'subject',
      'category',
      'urgency',
      'workflowStatus',
      'teacherName',
      'message',
    ];

    const csvLines = [
      headers.join(','),
      ...mapped.map((item) =>
        [
          item.id,
          item.createdAt || '',
          item.studentName || '',
          item.className || '',
          item.subject || '',
          item.category || '',
          item.urgency || '',
          item.workflowStatus || '',
          item.teacherName || '',
          item.message || '',
        ]
          .map(escapeCsv)
          .join(',')
      ),
    ];

    const filename = `feedback-intelligence-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvLines.join('\n'));
  } catch (error) {
    return sendServerError(res, error, 'Failed to export feedback intelligence.');
  }
};

module.exports = {
  getFeedbackOptions,
  generateFeedback,
  submitStudentToTeacherFeedback,
  submitStudentToAdminFeedback,
  submitStudentToParentFeedback,
  previewStudentAiFeedback,
  sendStudentAiFeedback,
  rewriteStudentFeedback,
  listFeedbacks,
  addReply,
  addFeedbackComment,
  listTeacherReviewQueue,
  reviewTeacherDraft,
  assignFeedbackFollowUpOwner,
  listAdminFeedbackIntelligence,
  exportAdminFeedbackIntelligence,
};
