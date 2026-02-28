const mongoose = require('mongoose');
const Broadcast = require('../models/Broadcast');
const User = require('../models/User');
const { createBulkNotifications } = require('./notificationService');

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

const asTrimmed = (value) => String(value || '').trim();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(asTrimmed(value));

const mapBroadcast = (item) => ({
  id: String(item._id),
  title: item.title || '',
  body: item.body || '',
  actionLine: item.actionLine || '',
  audienceRole: item.audienceRole || 'student',
  audienceClassNames: item.audienceClassNames || [],
  status: item.status || 'draft',
  scheduledFor: item.scheduledFor || null,
  publishedAt: item.publishedAt || null,
  recipientCount: Number(item.recipientCount || 0),
  createdById: item.createdById ? String(item.createdById) : '',
  createdByName: item.createdByName || '',
  aiGenerated: item.aiGenerated === true,
  aiLabel: item.aiLabel || '',
  aiUpdatedAt: item.aiUpdatedAt || null,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const callOpenRouter = async ({ messages, temperature = 0.3, maxTokens = 700 }) => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing.');
  }

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5000',
      'X-Title': 'Edu Bridge Broadcast Assistant',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed: ${text}`);
  }

  const payload = await response.json();
  return asTrimmed(payload?.choices?.[0]?.message?.content || '');
};

const parseJsonPayload = (value) => {
  const raw = asTrimmed(value);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
};

const resolveAudienceRoles = (audienceRole = 'student') => {
  if (audienceRole === 'both') return ['student', 'teacher'];
  if (audienceRole === 'teacher') return ['teacher'];
  return ['student'];
};

const resolveRecipients = async ({
  audienceRole = 'student',
  audienceClassNames = [],
  audienceUserIds = [],
} = {}) => {
  const roles = resolveAudienceRoles(audienceRole);
  const validUserIds = (Array.isArray(audienceUserIds) ? audienceUserIds : []).filter((id) =>
    isValidObjectId(id)
  );
  const classNames = [...new Set((Array.isArray(audienceClassNames) ? audienceClassNames : []).map((v) => asTrimmed(v)).filter(Boolean))];

  const query = {
    role: { $in: roles },
    isActive: { $ne: false },
  };

  if (validUserIds.length) {
    query._id = { $in: validUserIds };
  } else if (classNames.length) {
    query.classes = { $in: classNames };
  }

  const users = await User.find(query, { _id: 1, role: 1, name: 1, classes: 1 }).lean();
  return users.map((item) => ({
    id: String(item._id),
    role: item.role,
    name: item.name || '',
    classes: item.classes || [],
  }));
};

const publishBroadcast = async (broadcast) => {
  if (!broadcast || broadcast.status === 'published') {
    return broadcast;
  }

  const recipients = await resolveRecipients({
    audienceRole: broadcast.audienceRole,
    audienceClassNames: broadcast.audienceClassNames || [],
    audienceUserIds: broadcast.audienceUserIds || [],
  });

  const now = new Date();
  const notificationItems = recipients.map((user) => ({
    recipientId: user.id,
    recipientRole: user.role,
    category: 'broadcast',
    urgency: 'medium',
    title: broadcast.title,
    body: broadcast.body || '',
    link: user.role === 'student' ? '/student' : user.role === 'teacher' ? '/teacher' : '/admin/notifications',
    sourceType: 'broadcast',
    sourceId: String(broadcast._id),
    metadata: {
      actionLine: broadcast.actionLine || '',
      audienceRole: broadcast.audienceRole,
    },
  }));

  if (notificationItems.length) {
    await createBulkNotifications(notificationItems);
  }

  broadcast.status = 'published';
  broadcast.publishedAt = now;
  broadcast.recipientCount = recipients.length;
  await broadcast.save();

  return broadcast;
};

const publishDueBroadcasts = async () => {
  const now = new Date();
  const due = await Broadcast.find({
    status: 'scheduled',
    scheduledFor: { $ne: null, $lte: now },
  });

  if (!due.length) {
    return [];
  }

  const published = [];
  for (const item of due) {
    // eslint-disable-next-line no-await-in-loop
    const result = await publishBroadcast(item);
    published.push(result);
  }
  return published;
};

const listPublishedBroadcastsForUser = async ({ role, userId, classes = [] } = {}) => {
  await publishDueBroadcasts();

  if (!role || !userId) {
    return [];
  }

  if (!['student', 'teacher'].includes(role)) {
    return [];
  }

  const audienceRoleFilter = role === 'student' ? ['student', 'both'] : ['teacher', 'both'];
  const classNames = [...new Set((classes || []).map((v) => asTrimmed(v)).filter(Boolean))];

  const query = {
    status: 'published',
    audienceRole: { $in: audienceRoleFilter },
    $or: [
      { audienceUserIds: userId },
      { audienceClassNames: { $size: 0 }, audienceUserIds: { $size: 0 } },
      ...(classNames.length ? [{ audienceClassNames: { $in: classNames } }] : []),
    ],
  };

  const docs = await Broadcast.find(query).sort({ publishedAt: -1, createdAt: -1 }).lean();
  return docs.map(mapBroadcast);
};

const generateBroadcastDraft = async ({
  topic = '',
  context = '',
  audienceRole = 'student',
  tone = 'formal',
}) => {
  const fallback = {
    subjectLine: topic ? `School Notice: ${topic}` : 'School Notice',
    body: context
      ? `${context}\n\nPlease review this notice and follow the required next steps.`
      : 'Please review this school notice and follow the required next steps.',
    actionLine: 'Please acknowledge receipt and complete the requested action.',
    aiGenerated: false,
    aiLabel: '',
    aiUpdatedAt: new Date().toISOString(),
  };

  if (!process.env.OPENROUTER_API_KEY) {
    return fallback;
  }

  try {
    const raw = await callOpenRouter({
      messages: [
        {
          role: 'system',
          content:
            'You draft concise institutional school announcements. Return JSON with subjectLine, body, actionLine.',
        },
        {
          role: 'user',
          content: [
            `Topic: ${topic || 'General school announcement'}`,
            `Audience role: ${audienceRole}`,
            `Tone: ${tone}`,
            `Context: ${context || 'None'}`,
            'Rules: formal, calm, actionable, no emojis, no marketing language.',
            'Return strict JSON only.',
          ].join('\n'),
        },
      ],
    });

    const parsed = parseJsonPayload(raw);
    const subjectLine = asTrimmed(parsed?.subjectLine);
    const body = asTrimmed(parsed?.body);
    const actionLine = asTrimmed(parsed?.actionLine);
    if (!subjectLine || !body || !actionLine) {
      return fallback;
    }

    return {
      subjectLine,
      body,
      actionLine,
      aiGenerated: true,
      aiLabel: 'AI-generated draft',
      aiUpdatedAt: new Date().toISOString(),
    };
  } catch {
    return fallback;
  }
};

module.exports = {
  mapBroadcast,
  resolveRecipients,
  publishBroadcast,
  publishDueBroadcasts,
  listPublishedBroadcastsForUser,
  generateBroadcastDraft,
};
