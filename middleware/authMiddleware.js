const jwt = require('jsonwebtoken');
const User = require('../models/User');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'رأس التفويض غير صالح.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.sub);

    if (!user) {
      return res.status(401).json({ message: 'المستخدم المرتبط بالجلسة غير صالح.' });
    }

    if (decoded.role && decoded.role !== user.role) {
      return res.status(403).json({ message: 'عدم تطابق صلاحية الدور.' });
    }

    const userClasses = Array.isArray(user.classes) ? user.classes : [];
    const userSubjects = Array.isArray(user.subjects) ? user.subjects : [];

    req.user = {
      id: String(user._id),
      role: user.role,
      email: user.email || '',
      username: user.username || '',
      name: user.name,
      avatarUrl: user.avatarUrl || '',
      classes: user.role === 'student' ? userClasses.slice(0, 1) : userClasses,
      subjects: user.role === 'teacher' ? userSubjects.slice(0, 1) : userSubjects,
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

module.exports = {
  verifyToken,
  authenticate: verifyToken,
  authorize,
};
