const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { buildVerifyOptions } = require('../utils/jwtConfig');

const ensureBearerToken = (authHeader = '') => {
  const [scheme, token] = String(authHeader).split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }
  return token;
};

const verifyToken = async (req, res, next) => {
  const token = ensureBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ message: 'رأس التفويض غير صالح.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, buildVerifyOptions());
    if (!decoded?.sub || !decoded?.exp) {
      return res.status(401).json({ message: 'الرمز لا يحتوي على جلسة صالحة.' });
    }

    const user = await User.findById(decoded.sub);

    if (!user) {
      return res.status(401).json({ message: 'المستخدم المرتبط بالجلسة غير صالح.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: 'تم تعطيل الحساب.' });
    }

    if (decoded.role && decoded.role !== user.role) {
      return res.status(403).json({ message: 'عدم تطابق صلاحية الدور.' });
    }

    if (Number(decoded.ver || 0) !== Number(user.tokenVersion || 0)) {
      return res.status(401).json({ message: 'تم إبطال هذه الجلسة. يرجى تسجيل الدخول مجددًا.' });
    }

    req.user = {
      id: String(user._id),
      role: user.role,
      isActive: user.isActive !== false,
      email: user.email || '',
      username: user.username || '',
      name: user.name || '',
      profilePicture: user.profilePicture || user.avatarUrl || '',
      classes: Array.isArray(user.classes)
        ? user.role === 'student'
          ? user.classes.slice(0, 1)
          : user.classes
        : [],
      subjects: Array.isArray(user.subjects)
        ? user.role === 'teacher'
          ? user.subjects.slice(0, 1)
          : user.subjects
        : [],
      subject: user.subject || user.subjects?.[0] || '',
      linkedStudentIds: Array.isArray(user.linkedStudentIds)
        ? user.linkedStudentIds.map((item) => String(item))
        : [],
    };

    return next();
  } catch (_error) {
    return res.status(401).json({ message: 'انتهت الجلسة أو أن الرمز غير صالح.' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'يجب تسجيل الدخول أولاً.' });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'لا تملك صلاحية الوصول.' });
  }

  return next();
};

const adminOnly = authorize('admin');
const teacherOnly = authorize('teacher');
const studentOnly = authorize('student');
const parentOnly = authorize('parent');

module.exports = {
  verifyToken,
  authenticate: verifyToken,
  authorize,
  adminOnly,
  teacherOnly,
  studentOnly,
  parentOnly,
};
