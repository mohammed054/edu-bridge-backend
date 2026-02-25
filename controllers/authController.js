const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  normalizeIdentifier,
  normalizeEmail,
  detectRoleFromEmail,
} = require('../utils/userValidation');

const signToken = (user) =>
  jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
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
    } else {
      const normalizedEmail = normalizeEmail(identifier);
      const role = detectRoleFromEmail(normalizedEmail);

      if (!role) {
        return res.status(400).json({
          message:
            'Teacher email must start with tum and student email must start with stum, with domain @privatemoe.gov.ae.',
        });
      }

      user = await User.findOne({ email: normalizedEmail, role });
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
