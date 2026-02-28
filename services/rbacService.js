const SystemSetting = require('../models/SystemSetting');

const DEFAULT_PERMISSION_MATRIX = {
  super_admin: ['*'],
  academic_admin: [
    'dashboard.view',
    'students.view',
    'students.manage',
    'teachers.view',
    'teachers.manage',
    'classes.view',
    'classes.manage',
    'schedule.view',
    'schedule.manage',
    'reports.view',
    'reports.export',
    'surveys.view',
    'surveys.manage',
    'tickets.view',
    'tickets.manage',
    'notifications.view',
  ],
  attendance_manager: [
    'dashboard.view',
    'students.view',
    'attendance.view',
    'attendance.manage',
    'schedule.view',
    'schedule.manage',
    'reports.view',
    'reports.export',
  ],
  support_staff: [
    'dashboard.view',
    'students.view',
    'teachers.view',
    'classes.view',
    'notifications.view',
    'tickets.view',
    'tickets.manage',
    'surveys.view',
  ],
  teacher: [
    'teacher.dashboard',
    'teacher.schedule',
    'teacher.attendance',
    'teacher.grades',
    'teacher.feedback',
  ],
  student: [
    'student.dashboard',
    'student.schedule',
    'student.feedback',
    'student.surveys',
  ],
};

const asTrimmed = (value) => String(value || '').trim();
const ADMIN_PROFILE_ALIASES = {
  admin: 'academic_admin',
  administrator: 'academic_admin',
  enterprise_admin: 'academic_admin',
  ops_admin: 'attendance_manager',
  operations_admin: 'attendance_manager',
  attendance_admin: 'attendance_manager',
  support: 'support_staff',
  support_admin: 'support_staff',
  superadmin: 'super_admin',
};

const resolveAdminProfileKey = (adminProfile = 'none', matrix = DEFAULT_PERMISSION_MATRIX) => {
  const normalizedProfile = asTrimmed(adminProfile).toLowerCase();
  const safeMatrix =
    matrix && typeof matrix === 'object' ? matrix : DEFAULT_PERMISSION_MATRIX;

  if (
    normalizedProfile &&
    normalizedProfile !== 'none' &&
    Array.isArray(safeMatrix[normalizedProfile])
  ) {
    return normalizedProfile;
  }

  const aliasedProfile = ADMIN_PROFILE_ALIASES[normalizedProfile];
  if (aliasedProfile && Array.isArray(safeMatrix[aliasedProfile])) {
    return aliasedProfile;
  }

  if (Array.isArray(safeMatrix.academic_admin)) {
    return 'academic_admin';
  }

  return 'none';
};

const resolvePermissionMatrix = async (institutionId = 'hikmah-main') => {
  const setting = await SystemSetting.findOne(
    { institutionId },
    { permissionMatrix: 1 }
  ).lean();

  if (setting?.permissionMatrix && Object.keys(setting.permissionMatrix).length) {
    return {
      ...DEFAULT_PERMISSION_MATRIX,
      ...setting.permissionMatrix,
    };
  }

  return DEFAULT_PERMISSION_MATRIX;
};

const normalizeUserPermissionSet = ({
  role = '',
  adminProfile = 'none',
  explicitPermissions = [],
  matrix = DEFAULT_PERMISSION_MATRIX,
}) => {
  const normalizedRole = asTrimmed(role).toLowerCase();
  const safeMatrix = matrix && typeof matrix === 'object' ? matrix : DEFAULT_PERMISSION_MATRIX;
  const derivedRoleKey =
    normalizedRole === 'admin'
      ? resolveAdminProfileKey(adminProfile, safeMatrix)
      : normalizedRole;
  const inherited = Array.isArray(safeMatrix[derivedRoleKey]) ? safeMatrix[derivedRoleKey] : [];
  const explicit = Array.isArray(explicitPermissions)
    ? explicitPermissions.map((item) => asTrimmed(item)).filter(Boolean)
    : [];
  return [...new Set([...inherited, ...explicit])];
};

const canAccess = (permissionSet = [], permission = '') => {
  const target = asTrimmed(permission);
  if (!target) {
    return false;
  }

  if (permissionSet.includes('*') || permissionSet.includes(target)) {
    return true;
  }

  const [namespace] = target.split('.');
  return permissionSet.includes(`${namespace}.*`);
};

module.exports = {
  DEFAULT_PERMISSION_MATRIX,
  resolvePermissionMatrix,
  resolveAdminProfileKey,
  normalizeUserPermissionSet,
  canAccess,
};
