import { portalPrefix } from './navConfig';
import { ROLE_HOME } from './roleHome';

/**
 * "My PC" (جهازي) is available to every portal role, not only students. The backend decides who may use it
 * (config/drive.php → DRIVE_ROLES, default = every role); this module only builds the per-portal URL.
 */
export const MY_PC_ROLES = Object.keys(ROLE_HOME);

/** Distinct portal URL prefixes (security_admin / security_officer share `security`). */
export const MY_PC_PREFIXES = [...new Set(MY_PC_ROLES.map(portalPrefix))];

/** This role's My PC desktop route, e.g. admin → /admin/my-pc, data_analyst → /data-analysis/my-pc. */
export function myPcPath(role) {
  return `/${portalPrefix(role)}/my-pc`;
}

/** Does this role own a My PC drive? (Only a UI hint — the API enforces it.) */
export function hasMyPc(role) {
  return MY_PC_ROLES.includes(role);
}

/** Only students sit exams, so the Calendar app asks for them only there. */
export function showsExams(role) {
  return role === 'student';
}
