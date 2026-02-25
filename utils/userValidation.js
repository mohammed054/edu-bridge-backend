const EMAIL_DOMAIN = 'privatemoe.gov.ae';
const TEACHER_EMAIL_REGEX = /^tum\d*@privatemoe\.gov\.ae$/i;
const STUDENT_EMAIL_REGEX = /^stum\d*@privatemoe\.gov\.ae$/i;

const normalizeIdentifier = (identifier) => String(identifier || '').trim();

const normalizeEmail = (email) => normalizeIdentifier(email).toLowerCase();

const detectRoleFromEmail = (email) => {
  const value = normalizeEmail(email);

  if (TEACHER_EMAIL_REGEX.test(value)) {
    return 'teacher';
  }
  if (STUDENT_EMAIL_REGEX.test(value)) {
    return 'student';
  }
  return null;
};

const validateEmailByRole = (role, email) => {
  const value = normalizeEmail(email);

  if (!value) {
    return 'Email is required.';
  }

  const domain = value.split('@')[1] || '';
  if (domain !== EMAIL_DOMAIN) {
    return `Email domain must be @${EMAIL_DOMAIN}.`;
  }

  if (role === 'teacher' && !TEACHER_EMAIL_REGEX.test(value)) {
    return 'Teacher email must start with tum and end with @privatemoe.gov.ae.';
  }

  if (role === 'student' && !STUDENT_EMAIL_REGEX.test(value)) {
    return 'Student email must start with stum and end with @privatemoe.gov.ae.';
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
