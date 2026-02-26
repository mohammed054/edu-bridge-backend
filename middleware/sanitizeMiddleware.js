const MAX_STRING_LENGTH = 5000;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainObject = (value) =>
  Object.prototype.toString.call(value) === '[object Object]';

const cleanString = (value) => String(value).trim().slice(0, MAX_STRING_LENGTH);

const sanitizeValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (isPlainObject(value)) {
    return Object.entries(value).reduce((acc, [key, entry]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) {
        return acc;
      }

      if (BLOCKED_KEYS.has(normalizedKey)) {
        return acc;
      }

      // MongoDB operator injection protection.
      if (normalizedKey.startsWith('$') || normalizedKey.includes('.')) {
        return acc;
      }

      acc[normalizedKey] = sanitizeValue(entry);
      return acc;
    }, {});
  }

  if (typeof value === 'string') {
    return cleanString(value);
  }

  return value;
};

const sanitizeRequest = (req, _res, next) => {
  req.body = sanitizeValue(req.body || {});
  req.query = sanitizeValue(req.query || {});
  req.params = sanitizeValue(req.params || {});
  next();
};

module.exports = {
  sanitizeValue,
  sanitizeRequest,
};


