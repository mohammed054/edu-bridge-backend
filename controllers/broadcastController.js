const mongoose = require('mongoose');
const Broadcast = require('../models/Broadcast');
const {
  mapBroadcast,
  publishBroadcast,
  publishDueBroadcasts,
  generateBroadcastDraft,
} = require('../services/broadcastService');
const { sendServerError } = require('../utils/safeError');

const asTrimmed = (value) => String(value || '').trim();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(asTrimmed(value));

const normalizeAudienceRole = (value) => {
  const role = asTrimmed(value).toLowerCase();
  if (['student', 'teacher', 'both'].includes(role)) {
    return role;
  }
  return 'student';
};

const normalizeAudienceClassNames = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => asTrimmed(item)).filter(Boolean))];
};

const normalizeAudienceUserIds = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => asTrimmed(item)).filter((item) => isValidObjectId(item)))];
};

const listAdminBroadcasts = async (req, res) => {
  try {
    await publishDueBroadcasts();

    const status = asTrimmed(req.query?.status).toLowerCase();
    const audienceRole = asTrimmed(req.query?.audienceRole).toLowerCase();
    const query = {};

    if (['draft', 'scheduled', 'published'].includes(status)) {
      query.status = status;
    }
    if (['student', 'teacher', 'both'].includes(audienceRole)) {
      query.audienceRole = audienceRole;
    }

    const items = await Broadcast.find(query).sort({ createdAt: -1 }).lean();
    return res.json({ broadcasts: items.map(mapBroadcast) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load broadcasts.');
  }
};

const createAdminBroadcast = async (req, res) => {
  try {
    const title = asTrimmed(req.body?.title || req.body?.subjectLine);
    const body = asTrimmed(req.body?.body);
    const actionLine = asTrimmed(req.body?.actionLine);
    const audienceRole = normalizeAudienceRole(req.body?.audienceRole);
    const audienceClassNames = normalizeAudienceClassNames(req.body?.audienceClassNames || req.body?.classNames);
    const audienceUserIds = normalizeAudienceUserIds(req.body?.audienceUserIds || req.body?.userIds);
    const requestedStatus = asTrimmed(req.body?.status).toLowerCase();
    const scheduledForRaw = req.body?.scheduledFor;
    const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : null;
    const aiGenerated = req.body?.aiGenerated === true;
    const aiLabel = asTrimmed(req.body?.aiLabel);

    if (!title) {
      return res.status(400).json({ message: 'Broadcast title is required.' });
    }

    if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
      return res.status(400).json({ message: 'Scheduled publish datetime is invalid.' });
    }

    const status = ['draft', 'scheduled', 'published'].includes(requestedStatus)
      ? requestedStatus
      : scheduledFor
        ? 'scheduled'
        : 'draft';

    const created = await Broadcast.create({
      title,
      body,
      actionLine,
      audienceRole,
      audienceClassNames,
      audienceUserIds,
      status,
      scheduledFor,
      createdById: req.user.id,
      createdByName: req.user.name || 'Admin',
      aiGenerated,
      aiLabel,
      aiUpdatedAt: aiGenerated ? new Date() : null,
    });

    if (status === 'published') {
      await publishBroadcast(created);
    }

    return res.status(201).json({ broadcast: mapBroadcast(created.toObject()) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to create broadcast.');
  }
};

const updateAdminBroadcast = async (req, res) => {
  try {
    const broadcastId = asTrimmed(req.params?.id);
    if (!isValidObjectId(broadcastId)) {
      return res.status(400).json({ message: 'Broadcast identifier is invalid.' });
    }

    const target = await Broadcast.findById(broadcastId);
    if (!target) {
      return res.status(404).json({ message: 'Broadcast not found.' });
    }

    if (req.body?.title !== undefined) {
      const title = asTrimmed(req.body.title);
      if (!title) {
        return res.status(400).json({ message: 'Broadcast title is required.' });
      }
      target.title = title;
    }
    if (req.body?.body !== undefined) {
      target.body = asTrimmed(req.body.body);
    }
    if (req.body?.actionLine !== undefined) {
      target.actionLine = asTrimmed(req.body.actionLine);
    }
    if (req.body?.audienceRole !== undefined) {
      target.audienceRole = normalizeAudienceRole(req.body.audienceRole);
    }
    if (req.body?.audienceClassNames !== undefined || req.body?.classNames !== undefined) {
      target.audienceClassNames = normalizeAudienceClassNames(req.body.audienceClassNames || req.body.classNames);
    }
    if (req.body?.audienceUserIds !== undefined || req.body?.userIds !== undefined) {
      target.audienceUserIds = normalizeAudienceUserIds(req.body.audienceUserIds || req.body.userIds);
    }
    if (req.body?.scheduledFor !== undefined) {
      if (!req.body.scheduledFor) {
        target.scheduledFor = null;
      } else {
        const parsed = new Date(req.body.scheduledFor);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ message: 'Scheduled publish datetime is invalid.' });
        }
        target.scheduledFor = parsed;
      }
    }
    if (req.body?.status !== undefined) {
      const status = asTrimmed(req.body.status).toLowerCase();
      if (!['draft', 'scheduled', 'published'].includes(status)) {
        return res.status(400).json({ message: 'Broadcast status is invalid.' });
      }
      target.status = status;
    }
    if (req.body?.aiGenerated !== undefined) {
      target.aiGenerated = req.body.aiGenerated === true;
      target.aiLabel = target.aiGenerated ? asTrimmed(req.body?.aiLabel || 'AI-generated draft') : '';
      target.aiUpdatedAt = target.aiGenerated ? new Date() : null;
    }

    await target.save();
    if (target.status === 'published') {
      await publishBroadcast(target);
    }

    return res.json({ broadcast: mapBroadcast(target.toObject()) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to update broadcast.');
  }
};

const deleteAdminBroadcast = async (req, res) => {
  try {
    const broadcastId = asTrimmed(req.params?.id);
    if (!isValidObjectId(broadcastId)) {
      return res.status(400).json({ message: 'Broadcast identifier is invalid.' });
    }

    const deleted = await Broadcast.findByIdAndDelete(broadcastId).lean();
    if (!deleted) {
      return res.status(404).json({ message: 'Broadcast not found.' });
    }

    return res.json({ success: true, deletedId: String(deleted._id) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to delete broadcast.');
  }
};

const generateAdminBroadcastDraft = async (req, res) => {
  try {
    const draft = await generateBroadcastDraft({
      topic: asTrimmed(req.body?.topic),
      context: asTrimmed(req.body?.context),
      audienceRole: normalizeAudienceRole(req.body?.audienceRole),
      tone: asTrimmed(req.body?.tone || 'formal'),
    });

    return res.json({ draft });
  } catch (error) {
    return sendServerError(res, error, 'Failed to generate broadcast draft.');
  }
};

module.exports = {
  listAdminBroadcasts,
  createAdminBroadcast,
  updateAdminBroadcast,
  deleteAdminBroadcast,
  generateAdminBroadcastDraft,
};
