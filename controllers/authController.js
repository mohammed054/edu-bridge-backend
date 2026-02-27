const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { buildSignOptions } = require('../utils/jwtConfig');
const { sendServerError } = require('../utils/safeError');
const {
  normalizeIdentifier,
  normalizeEmail,
  validateEmailByRole,
  validateAdminIdentifier,
  ADMIN_USERNAME,
} = require('../utils/userValidation');

const signToken = (user) =>
  jwt.sign(
    {
      role: user.role,
      ver: Number(user.tokenVersion || 0),
    },
    process.env.JWT_SECRET,
    {
      ...buildSignOptions(String(user._id)),
      jwtid: crypto.randomUUID(),
    }
  );

const buildAuthResponse = (user) => {
  const token = signToken(user);
  const decoded = jwt.decode(token) || {};

  return {
    token,
    expiresAt: decoded?.exp ? new Date(Number(decoded.exp) * 1000).toISOString() : null,
    user: user.toSafeObject(),
  };
};

const isStudentLoginTestMode = () => {
  const raw = String(process.env.STUDENT_LOGIN_TEST_MODE || '')
    .trim()
    .toLowerCase();
  const enabled = ['1', 'true', 'yes', 'on'].includes(raw);
  return process.env.NODE_ENV !== 'production' && enabled;
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
    return sendServerError(res, error, 'تعذر تسجيل دخول الطالب.');
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
    return sendServerError(res, error, 'تعذر تسجيل دخول المعلم.');
  }
};

const loginParent = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || req.body?.identifier);
    const password = String(req.body?.password || '');
    const emailError = validateEmailByRole('parent', email);

    if (emailError) {
      return res.status(400).json({ message: emailError });
    }

    if (!password) {
      return res.status(400).json({ message: 'كلمة المرور مطلوبة.' });
    }

    const user = await User.findOne({ role: 'parent', email });
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
    return sendServerError(res, error, 'تعذر تسجيل دخول ولي الأمر.');
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
    return sendServerError(res, error, 'تعذر تسجيل دخول الإدارة.');
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

  if (portal === 'parent') {
    return loginParent(req, res);
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
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود.' });
    }

    return res.json({ user: user.toSafeObject() });
  } catch (error) {
    return sendServerError(res, error, 'تعذر تحميل بيانات المستخدم.');
  }
};

const logout = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود.' });
    }

    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    await user.save();

    return res.json({ success: true });
  } catch (error) {
    return sendServerError(res, error, 'تعذر تسجيل الخروج.');
  }
};

module.exports = {
  login,
  loginStudent,
  loginTeacher,
  loginParent,
  loginAdmin,
  getCurrentUser,
  logout,
};
