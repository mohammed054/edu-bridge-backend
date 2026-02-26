const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const EMAIL_DOMAIN = '';
const TEACHER_EMAIL_REGEX = BASIC_EMAIL_REGEX;
const STUDENT_EMAIL_REGEX = BASIC_EMAIL_REGEX;

const normalizeIdentifier = (identifier) => String(identifier || '').trim();

const normalizeEmail = (email) => normalizeIdentifier(email).toLowerCase();

const detectRoleFromEmail = () => null;

const validateEmailByRole = (_role, email) => {
  const value = normalizeEmail(email);

  if (!value) {
    return 'البريد الإلكتروني مطلوب.';
  }

  if (!BASIC_EMAIL_REGEX.test(value)) {
    return 'صيغة البريد الإلكتروني غير صحيحة.';
  }

  return null;
};

const normalizeClasses = (classes) => {
  if (!Array.isArray(classes)) {
    return [];
  }

  return [...new Set(classes.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

module.exports = {
  EMAIL_DOMAIN,
  TEACHER_EMAIL_REGEX,
  STUDENT_EMAIL_REGEX,
  normalizeIdentifier,
  normalizeEmail,
  detectRoleFromEmail,
  validateEmailByRole,
  normalizeClasses,
};
