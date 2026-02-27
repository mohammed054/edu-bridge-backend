const asTrimmed = (value) => String(value || '').trim();

const defaultKeyGenerator = (req) => asTrimmed(req.ip) || 'unknown-ip';

const createRateLimiter = ({
  windowMs = 60 * 1000,
  max = 60,
  message = 'Too many requests. Please try again later.',
  keyGenerator = defaultKeyGenerator,
} = {}) => {
  const buckets = new Map();
  let requestCounter = 0;

  return (req, res, next) => {
    const key = keyGenerator(req) || defaultKeyGenerator(req);
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, windowStart: now };

    requestCounter += 1;
    if (requestCounter % 200 === 0) {
      for (const [bucketKey, bucketItem] of buckets.entries()) {
        if (now - bucketItem.windowStart > windowMs * 2) {
          buckets.delete(bucketKey);
        }
      }
    }

    if (now - bucket.windowStart >= windowMs) {
      bucket.count = 0;
      bucket.windowStart = now;
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((windowMs - (now - bucket.windowStart)) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
      return res.status(429).json({ message });
    }

    return next();
  };
};

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please try again in a few minutes.',
  keyGenerator: (req) => {
    const identifier =
      asTrimmed(req.body?.identifier).toLowerCase() || asTrimmed(req.body?.email).toLowerCase();
    return `${asTrimmed(req.ip)}|${identifier || 'anonymous'}`;
  },
});

const messageRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 12,
  message: 'Message rate exceeded. Slow down and try again.',
  keyGenerator: (req) => `${asTrimmed(req.user?.id) || asTrimmed(req.ip)}|message`,
});

const incidentRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Incident rate exceeded. Slow down and try again.',
  keyGenerator: (req) => `${asTrimmed(req.user?.id) || asTrimmed(req.ip)}|incident`,
});

const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 500,
  message: 'API rate limit exceeded. Please retry shortly.',
  keyGenerator: defaultKeyGenerator,
});

module.exports = {
  apiRateLimiter,
  createRateLimiter,
  incidentRateLimiter,
  loginRateLimiter,
  messageRateLimiter,
};
