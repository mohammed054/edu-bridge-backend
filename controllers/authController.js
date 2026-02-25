const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  normalizeIdentifier,
  normalizeEmail,
  detectRoleFromEmail,
} = require('../utils/userValidation');

const resolveJwtOptions = () => {
  const raw = String(process.env.JWT_EXPIRES_IN || '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'none' || raw === 'off') {
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

const login = async (req, res) => {
  try {
    const identifier = normalizeIdentifier(req.body?.identifier);
    const password = String(req.body?.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Identifier and password are required.' });
    }

    let user = null;
    const normalizedIdentifier = identifier.toLowerCase();

    if (normalizedIdentifier === 'admin') {
      user = await User.findOne({ role: 'admin', username: 'admin' });
    } else if (normalizedIdentifier.includes('@')) {
      const normalizedEmail = normalizeEmail(identifier);
      const role = detectRoleFromEmail(normalizedEmail);

      if (!role) {
        return res.status(400).json({
          message:
            'Teacher email must start with tum and student email must start with stum, with domain @privatemoe.gov.ae.',
        });
      }

      user = await User.findOne({ email: normalizedEmail, role });
    } else {
      user = await User.findOne({ username: normalizedIdentifier });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    return res.json(buildAuthResponse(user));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Login failed.' });
  }
};

const getCurrentUser = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  return res.json({ user: user.toSafeObject() });
};

module.exports = {
  login,
  getCurrentUser,
};
