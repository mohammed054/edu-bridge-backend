const AuditLog = require('../models/AuditLog');

const asTrimmed = (value) => String(value || '').trim();

const writeAuditLog = async ({
  actorId,
  actorRole,
  action,
  entityType,
  entityId,
  metadata = {},
  ipAddress = '',
  userAgent = '',
}) => {
  if (!actorId || !actorRole || !action || !entityType || !entityId) {
    return null;
  }

  return AuditLog.create({
    actorId,
    actorRole,
    action: asTrimmed(action),
    entityType: asTrimmed(entityType),
    entityId: asTrimmed(entityId),
    metadata,
    ipAddress: asTrimmed(ipAddress),
    userAgent: asTrimmed(userAgent).slice(0, 512),
  });
};

const mapAuditLog = (entry) => ({
  id: String(entry._id),
  actorId: String(entry.actorId),
  actorRole: entry.actorRole,
  action: entry.action,
  entityType: entry.entityType,
  entityId: entry.entityId,
  metadata: entry.metadata || {},
  ipAddress: entry.ipAddress || '',
  userAgent: entry.userAgent || '',
  createdAt: entry.createdAt,
});

module.exports = {
  mapAuditLog,
  writeAuditLog,
};
