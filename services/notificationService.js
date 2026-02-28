const mongoose = require('mongoose');
const Notification = require('../models/Notification');

const asTrimmed = (value) => String(value || '').trim();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(asTrimmed(value));

const createNotification = async ({
  recipientId,
  recipientRole,
  category = 'system',
  urgency = 'low',
  title,
  body = '',
  link = '',
  sourceType = '',
  sourceId = '',
  metadata = {},
}) => {
  const cleanRecipientId = asTrimmed(recipientId);
  if (!isValidObjectId(cleanRecipientId) || !asTrimmed(title)) {
    return null;
  }

  const created = await Notification.create({
    recipientId: cleanRecipientId,
    recipientRole: asTrimmed(recipientRole).toLowerCase(),
    category: asTrimmed(category).toLowerCase() || 'system',
    urgency: asTrimmed(urgency).toLowerCase() || 'low',
    title: asTrimmed(title),
    body: asTrimmed(body),
    link: asTrimmed(link),
    sourceType: asTrimmed(sourceType),
    sourceId: asTrimmed(sourceId),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });

  return created;
};

const createBulkNotifications = async (items = []) => {
  const docs = (Array.isArray(items) ? items : [])
    .map((item) => ({
      recipientId: asTrimmed(item?.recipientId),
      recipientRole: asTrimmed(item?.recipientRole).toLowerCase(),
      category: asTrimmed(item?.category).toLowerCase() || 'system',
      urgency: asTrimmed(item?.urgency).toLowerCase() || 'low',
      title: asTrimmed(item?.title),
      body: asTrimmed(item?.body),
      link: asTrimmed(item?.link),
      sourceType: asTrimmed(item?.sourceType),
      sourceId: asTrimmed(item?.sourceId),
      metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {},
    }))
    .filter((item) => isValidObjectId(item.recipientId) && item.title);

  if (!docs.length) {
    return [];
  }

  return Notification.insertMany(docs, { ordered: false });
};

module.exports = {
  createNotification,
  createBulkNotifications,
};
