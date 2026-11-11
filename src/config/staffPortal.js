/**
 * Hidden sign-in page for platform staff (admin, data analyst, security).
 * It is not linked from anywhere — staff open it by typing the address.
 * Change the address without touching code: set VITE_STAFF_LOGIN_PATH
 * (e.g. /ops-9f3k2) in the hosting environment variables and redeploy.
 * The backend refuses staff roles on the public /auth/login (see LoginController).
 */
const raw = (import.meta.env.VITE_STAFF_LOGIN_PATH || '/staff-access').trim();
export const STAFF_LOGIN_PATH = raw.startsWith('/') ? raw : `/${raw}`;
