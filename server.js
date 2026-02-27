require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./db');
const { sanitizeRequest } = require('./middleware/sanitizeMiddleware');
const { securityHeaders } = require('./middleware/securityHeaders');
const { apiRateLimiter } = require('./middleware/rateLimitMiddleware');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const profileRoutes = require('./routes/profileRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const surveyRoutes = require('./routes/surveyRoutes');
const studentRoutes = require('./routes/studentRoutes');

const app = express();
app.disable('x-powered-by');

if (!process.env.MONGO_URI) {
  throw new Error('MONGO_URI is required in .env');
}

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in .env');
}

const resolveAllowedOrigins = () => {
  const envValue = process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '';
  const fromEnv = envValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ];

  return new Set(fromEnv.length ? fromEnv : defaults);
};

const allowedOrigins = resolveAllowedOrigins();

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(securityHeaders);
app.use(express.json({ limit: '15mb' }));
app.use(sanitizeRequest);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const logoPath = path.join(__dirname, 'assets', 'hikmah-logo.svg');
app.get('/api/assets/hikmah-logo.svg', (_req, res) => {
  res.sendFile(logoPath);
});

app.get('/api/assets/hikmah-logo', (_req, res) => {
  res.json({
    logoUrl: '/api/assets/hikmah-logo.svg',
  });
});

app.use('/api/assets', express.static(path.join(__dirname, 'assets')));
app.use('/api', apiRateLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/surveys', surveyRoutes);

app.use('/api/*', (req, res) => {
  res.status(404).json({
    message: 'Route not found.',
  });
});

app.use((err, _req, res, _next) => {
  const status = Number(err?.status || 500);
  const payload = {
    message: status >= 500 ? 'حدث خطأ غير متوقع.' : err.message,
  };
  if (process.env.NODE_ENV !== 'production') {
    payload.debug = err.message;
  }
  res.status(status).json(payload);
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`Server running on port ${PORT}`);
      }
    });
  })
  .catch(() => {
    console.error('Database connection failed.');
    process.exit(1);
  });

module.exports = app;


