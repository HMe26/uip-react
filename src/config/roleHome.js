// Mirrors RoleService::homeRouteFor() on the backend (app/Services/RoleService.php)
// and config/roles.php's home_route entries. Single source of truth for every
// place in the SPA that needs to send an authenticated user to their portal
// home — Login.jsx (after password step), TwoFactor.jsx (after 2FA-enabled
// login), and Landing.jsx (already-authenticated visitor hitting "/").
// Keep all three in sync by importing this instead of redefining the map.
export const ROLE_HOME = {
  student: '/student/dashboard',
  university: '/university/dashboard',
  admin: '/admin/dashboard',
  data_analyst: '/data-analysis/dashboard',
  security_admin: '/security/dashboard',
  security_officer: '/security/dashboard',
  supervisor: '/supervisor/dashboard',
  academic_staff: '/academic-staff/dashboard',
  faculty: '/faculty/dashboard',
};

export function roleHome(role) {
  return ROLE_HOME[role] || '/dashboard';
}
