const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const ADMIN_USERNAME = 'admin';
const TEACHER_EMAIL_REGEX = /^tum[a-z0-9]*@privatemoe\.gov\.ae$/i;
const STUDENT_EMAIL_REGEX = /^stum[a-z0-9]*@(moe\.sch\.ae|privatemoe\.gov\.ae)$/i;

const normalizeIdentifier = (identifier) => String(identifier || '').trim();
const normalizeEmail = (email) => normalizeIdentifier(email).toLowerCase();

const detectRoleFromEmail = (email) => {
  const value = normalizeEmail(email);
  if (!value) {
    return null;
  }

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
    return 'البريد الإلكتروني مطلوب.';
  }

  if (!BASIC_EMAIL_REGEX.test(value)) {
    return 'صيغة البريد الإلكتروني غير صحيحة.';
  }

  return null;
};

const validateAdminIdentifier = (identifier) => {
  const value = normalizeIdentifier(identifier).toLowerCase();
  if (!value) {
    return 'معرف الإدارة مطلوب.';
  }

  if (value !== ADMIN_USERNAME) {
    return 'معرف الإدارة المسموح هو admin فقط.';
  }

  return null;
};

const normalizeClasses = (classes) => {
  if (!Array.isArray(classes)) {
    return [];
  }

  return [...new Set(classes.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

const normalizeSubjects = (subjects) => {
  if (!Array.isArray(subjects)) {
    return [];
  }

  return [...new Set(subjects.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

module.exports = {
  ADMIN_USERNAME,
  TEACHER_EMAIL_REGEX,
  STUDENT_EMAIL_REGEX,
  normalizeIdentifier,
  normalizeEmail,
  detectRoleFromEmail,
  validateEmailByRole,
  validateAdminIdentifier,
  normalizeClasses,
  normalizeSubjects,
};
