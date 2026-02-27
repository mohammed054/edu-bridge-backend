const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  normalizeIdentifier,
  normalizeEmail,
  validateEmailByRole,
  validateAdminIdentifier,
  ADMIN_USERNAME,
} = require('../utils/userValidation');

const resolveJwtOptions = () => {
  const raw = String(process.env.JWT_EXPIRES_IN || '').trim().toLowerCase();
  if (!raw || ['0', 'false', 'none', 'off'].includes(raw)) {
    return undefined;
  }

  return { expiresIn: process.env.JWT_EXPIRES_IN };
};

const signToken = (user) =>
  jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
    },
    process.env.JWT_SECRET,
    resolveJwtOptions()
  );

const buildAuthResponse = (user) => ({
  token: signToken(user),
  user: user.toSafeObject(),
});

const isStudentLoginTestMode = () => {
  const raw = String(process.env.STUDENT_LOGIN_TEST_MODE || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
};

const verifyPassword = async (plainPassword, user) => {
  const value = String(plainPassword || '');
  if (!value || !user?.passwordHash) {
    return false;
  }
  return bcrypt.compare(value, user.passwordHash);
};

const loginStudent = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || req.body?.identifier);
    const password = String(req.body?.password || '');
    const emailError = validateEmailByRole('student', email);

    if (emailError) {
      return res.status(400).json({ message: emailError });
    }

    const user = await User.findOne({ role: 'student', email });
    if (!user) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: 'تم تعطيل هذا الحساب.' });
    }

    if (!isStudentLoginTestMode()) {
      const validPassword = await verifyPassword(password, user);
      if (!validPassword) {
        return res.status(401).json({ message: 'بيانات الدخول غير صحيحة.' });
      }
    }

    return res.json(buildAuthResponse(user));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تسجيل دخول الطالب.' });
  }
};

const loginTeacher = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || req.body?.identifier);
    const password = String(req.body?.password || '');
    const emailError = validateEmailByRole('teacher', email);

    if (emailError) {
      return res.status(400).json({ message: emailError });
    }

    if (!password) {
      return res.status(400).json({ message: 'كلمة المرور مطلوبة.' });
    }

    const user = await User.findOne({ role: 'teacher', email });
    if (!user) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: 'تم تعطيل هذا الحساب.' });
    }

    const validPassword = await verifyPassword(password, user);
    if (!validPassword) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة.' });
    }

    return res.json(buildAuthResponse(user));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تسجيل دخول المعلم.' });
  }
};

const loginAdmin = async (req, res) => {
  try {
    const identifier = normalizeIdentifier(req.body?.identifier || req.body?.email).toLowerCase();
    const password = String(req.body?.password || '');

    const identifierError = validateAdminIdentifier(identifier);
    if (identifierError) {
      return res.status(400).json({ message: identifierError });
    }

    if (!password) {
      return res.status(400).json({ message: 'كلمة المرور مطلوبة.' });
    }

    const user = await User.findOne({ role: 'admin', username: ADMIN_USERNAME });
    if (!user) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: 'تم تعطيل هذا الحساب.' });
    }

    const validPassword = await verifyPassword(password, user);
    if (!validPassword) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة.' });
    }

    return res.json(buildAuthResponse(user));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'تعذر تسجيل دخول الإدارة.' });
  }
};

const login = async (req, res) => {
  const portal = String(req.body?.portal || req.body?.loginType || '').trim().toLowerCase();

  if (portal === 'student') {
    return loginStudent(req, res);
  }

  if (portal === 'teacher') {
    return loginTeacher(req, res);
  }

  if (portal === 'admin') {
    return loginAdmin(req, res);
  }

  const identifier = normalizeIdentifier(req.body?.identifier || req.body?.email).toLowerCase();
  const hasPassword = Boolean(String(req.body?.password || '').trim());

  if (identifier.includes('@') && !hasPassword) {
    return loginStudent(req, res);
  }

  if (identifier.includes('@')) {
    return loginTeacher(req, res);
  }

  return loginAdmin(req, res);
};

const getCurrentUser = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'المستخدم غير موجود.' });
  }

  return res.json({ user: user.toSafeObject() });
};

module.exports = {
  login,
  loginStudent,
  loginTeacher,
  loginAdmin,
  getCurrentUser,
};
