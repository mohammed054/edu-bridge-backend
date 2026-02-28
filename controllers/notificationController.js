const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { sendServerError } = require('../utils/safeError');

const asTrimmed = (value) => String(value || '').trim();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(asTrimmed(value));

const mapNotification = (item) => ({
  id: String(item._id),
  category: item.category || 'system',
  urgency: item.urgency || 'low',
  title: item.title || '',
  body: item.body || '',
  link: item.link || '',
  sourceType: item.sourceType || '',
  sourceId: item.sourceId || '',
  isRead: Boolean(item.isRead),
  readAt: item.readAt || null,
  isPinned: Boolean(item.isPinned),
  metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const listNotifications = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 500);
    const category = asTrimmed(req.query?.category).toLowerCase();
    const unreadOnly = asTrimmed(req.query?.unreadOnly).toLowerCase() === 'true';
    const pinnedOnly = asTrimmed(req.query?.pinnedOnly).toLowerCase() === 'true';

    const query = {
      recipientId: req.user.id,
      recipientRole: req.user.role,
    };

    if (category) {
      query.category = category;
    }
    if (unreadOnly) {
      query.isRead = false;
    }
    if (pinnedOnly) {
      query.isPinned = true;
    }

    const [items, unreadCount, pinnedCount] = await Promise.all([
      Notification.find(query).sort({ isPinned: -1, isRead: 1, createdAt: -1 }).limit(limit).lean(),
      Notification.countDocuments({
        recipientId: req.user.id,
        recipientRole: req.user.role,
        isRead: false,
      }),
      Notification.countDocuments({
        recipientId: req.user.id,
        recipientRole: req.user.role,
        isPinned: true,
      }),
    ]);

    const byCategory = items.reduce((acc, item) => {
      const key = item.category || 'system';
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      notifications: items.map(mapNotification),
      unreadCount,
      pinnedCount,
      byCategory,
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load notifications.');
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const notificationId = asTrimmed(req.params?.id);
    if (!isValidObjectId(notificationId)) {
      return res.status(400).json({ message: 'Notification identifier is invalid.' });
    }

    const updated = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        recipientId: req.user.id,
        recipientRole: req.user.role,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: 'Notification not found.' });
    }

    return res.json({ notification: mapNotification(updated) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to mark notification as read.');
  }
};

const markAllNotificationsRead = async (req, res) => {
  try {
    const now = new Date();
    const result = await Notification.updateMany(
      {
        recipientId: req.user.id,
        recipientRole: req.user.role,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: now,
        },
      }
    );

    return res.json({
      success: true,
      updatedCount: Number(result.modifiedCount || 0),
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to mark all notifications as read.');
  }
};

const toggleNotificationPin = async (req, res) => {
  try {
    const notificationId = asTrimmed(req.params?.id);
    if (!isValidObjectId(notificationId)) {
      return res.status(400).json({ message: 'Notification identifier is invalid.' });
    }

    const target = await Notification.findOne({
      _id: notificationId,
      recipientId: req.user.id,
      recipientRole: req.user.role,
    });

    if (!target) {
      return res.status(404).json({ message: 'Notification not found.' });
    }

    target.isPinned = !target.isPinned;
    await target.save();

    return res.json({ notification: mapNotification(target.toObject()) });
  } catch (error) {
    return sendServerError(res, error, 'Failed to toggle notification pin.');
  }
};

module.exports = {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  toggleNotificationPin,
};
