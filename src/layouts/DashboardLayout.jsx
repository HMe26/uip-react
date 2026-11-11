import { useCallback, useEffect, useRef, useState } from 'react';
import { observeTables } from '../lib/labelTables';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Topbar from '../components/Topbar';
import BottomNav from '../components/BottomNav';
import AmbientBackdrop from '../components/AmbientBackdrop';
import AiAssistantWidget from '../components/ai-assistant/AiAssistantWidget';
import { useAuth } from '../context/AuthContext';
import { getNavConfig, matchNavItem } from '../config/navConfig';
import NoPermission from '../components/NoPermission';
import { useLanguage } from '../context/LanguageContext';
import { PageMetaProvider, PageMetaSync } from '../context/PageMetaContext';
import { api } from '../api/client';
import { useLive } from '../hooks/useLive';
import { fetchSummary } from '../lib/appSummary';
import { getPortalBrand } from '../config/portalBrand';
import { ExamLockProvider, useExamLock } from '../context/ExamLockContext';
import { useBackLayer, useSeedBackStack } from '../lib/backStack';
import { roleHome } from '../config/roleHome';
import { VirtualGuard } from '../virtual/virtualMode';
import { isEmbedded } from '../lib/embed';
import '../styles/css/embed.css';

// "UIPE / DASHBOARD" eyebrow shown above every Insight-portal page title.
function useEyebrow(role, enabled) {
  const { pathname } = useLocation();
  const { locale } = useLanguage();
  if (!enabled) return null;
  const items = Object.values(getNavConfig(role)).flat();
  const hit = items
    .filter((i) => i.route && (pathname === i.route || pathname.startsWith(`${i.route}/`)))
    .sort((a, b) => b.route.length - a.route.length)[0];
  const seg = pathname.split('/').filter(Boolean).slice(1, 2)[0] || '';
  const name = hit ? (hit[locale] || hit.en) : seg.replace(/-/g, ' ');
  return `UIPE / ${name}`;
}

// Ported from layouts/header.php + layouts/footer.php's <div class="app-shell">
// structure: fixed sidebar, topbar + routed content on the right, bottom nav
// on mobile. Used as the element for every protected route group — see App.jsx.
export default function DashboardLayout() {
  const { user } = useAuth();
  return (
    <ExamLockProvider enabled={user?.role === 'student'}>
      {/* virtual mode: a student's portal page is shown as a window of the desktop instead (exam / meeting room / print pages stay full pages) */}
      <VirtualGuard>
        <DashboardShell />
      </VirtualGuard>
    </ExamLockProvider>
  );
}

function DashboardShell() {
  const { user, logout, can } = useAuth();
  const { pathname } = useLocation();
  // A page whose permission an admin just took away closes right away instead of erroring on every call.
  const navItem = matchNavItem(user?.role, pathname);
  const blocked = !!(navItem?.perm && !can(navItem.perm));
  const examLock = useExamLock();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Phone Back closes the open drawer instead of leaving the page; a page opened straight from a link
  // gets the portal home underneath it so Back does not exit the site.
  useBackLayer(sidebarOpen, () => setSidebarOpen(false));
  useSeedBackStack(roleHome(user?.role), examLock.locked);
  // Tablets (769–1100px) keep the desktop sidebar but start it as the icon rail so the content has room.
  // The person can still expand/collapse it with the toggle; crossing the breakpoint re-applies the default.
  const TABLET_QUERY = '(min-width: 769px) and (max-width: 1100px)';
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia(TABLET_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(TABLET_QUERY);
    const onChange = (e) => setCollapsed(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  const [unread, setUnread] = useState(0);
  // Every portal uses the Insight Platform shell (see
  // styles/css/insight-portal.css); per-portal differences (brand subtitle,
  // promo card, search scope) come from config/portalBrand.js.
  const insight = true;
  const shellKind = getPortalBrand(user?.role).shell;
  const isStudentShell = shellKind === 'student';
  const isStaffShell = shellKind === 'staff';
  const isAdminShell = shellKind === 'admin';
  const isFacultyShell = shellKind === 'faculty' || isAdminShell;
  // Admin pages: each page's hero gets its own icon (styles/css/admin-pages.css keys off data-admin-page),
  // and every table turns into cards on phones.
  const mainRef = useRef(null);
  const adminSegs = pathname.split('/').filter(Boolean).slice(1);
  const adminPage = isAdminShell ? (adminSegs[0] === 'messaging' ? `messaging-${adminSegs[1] || ''}` : adminSegs[0] || '') : undefined;
  const tablesReady = examLock.ready && !examLock.locked;
  useEffect(() => (tablesReady && mainRef.current ? observeTables(mainRef.current) : undefined), [tablesReady]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const eyebrow = useEyebrow(user?.role, insight);

  // Unread-messages badge (sidebar + bottom bar) for every role: total unread messages across the person's conversations,
  // from the same inbox the Messages page uses (best-effort, no badge on failure). Refreshes on any messaging activity,
  // on realtime pings, when the app comes back to the foreground, and every 30 s as a safety net.
  const loadUnreadMessages = useCallback(() => {
    if (!user) return;
    // Preferred: the number from the shared app summary (no inbox download at all); old endpoint only as a fallback.
    fetchSummary({ maxAge: 3000 }).then((sum) => {
      if (sum && typeof sum.unread_messages === 'number') { setUnreadMessages(sum.unread_messages); return null; }
      if (sum && sum.unread_messages === null && sum.permissions) return null; // no messaging access: no badge, no request
      return api.get('/api/v1/messaging/inbox').then((json) => {
        const rows = Array.isArray(json?.data) ? json.data : null;
        if (!rows) return;
        setUnreadMessages(rows.reduce((sum2, c) => sum2 + (c.is_muted ? 0 : Number(c.unread_count || (c.is_unread ? 1 : 0))), 0));
      });
    }).catch(() => {});
  }, [user]);
  // The My PC desktop is a full-screen overlay with its own notifications / clock / sync: while it is open the page shell below
  // (sidebar, topbar, bottom bar, animated backdrop and every request they poll) is invisible work, so it is not mounted at all.
  const inDesktopOs = /\/my-pc\/?$/.test(pathname);
  useEffect(() => { if (!inDesktopOs) loadUnreadMessages(); }, [loadUnreadMessages, inDesktopOs]);
  useLive(loadUnreadMessages, { watch: /\/(messaging|messages)(\/|$|\?)/, interval: 30000, enabled: !!user && !inDesktopOs, topics: ['messaging'] });
  useEffect(() => {
    const on = () => loadUnreadMessages();
    window.addEventListener('uip:push-received', on);
    return () => window.removeEventListener('uip:push-received', on);
  }, [loadUnreadMessages]);

  // Desktop: collapse the sidebar to icons. Mobile (<=768px, where the
  // sidebar is an off-canvas drawer): open/close the drawer instead.
  const toggleSidebar = () => {
    if (insight && window.matchMedia('(min-width: 769px)').matches) setCollapsed((c) => !c);
    else setSidebarOpen((o) => !o);
  };

  // ---- Exam lock-down -----------------------------------------------------
  // Student with an in-progress attempt: only the attempt page is reachable.
  // Any other URL (typed, back button, second tab) is sent straight back, and
  // the shell below renders without sidebar / topbar / bottom nav / AI.
  if (!examLock.ready) {
    return <div className="exam-lock-loading" role="status" aria-live="polite" />;
  }
  if (examLock.locked) {
    const attemptPath = `/student/exam-attempt/${examLock.attemptId}`;
    if (pathname.replace(/\/+$/, '') !== attemptPath) {
      return <Navigate to={attemptPath} replace />;
    }
    return (
      <PageMetaProvider>
        <div className="app-shell app-shell--exam-lock">
          <main className="app-shell__main app-shell__main--exam-lock">
            <Outlet />
          </main>
        </div>
      </PageMetaProvider>
    );
  }

  // Floating-chat drawer: the page alone, no sidebar / topbar / bottom bar / assistant.
  if (isEmbedded) {
    return (
      <PageMetaProvider>
        <div data-portal={user?.role} className="app-shell app-shell--insight app-shell--embed">
          <div className="app-shell__content">
            <main className="app-shell__main">{blocked ? <NoPermission permission={navItem.perm} /> : <Outlet />}</main>
          </div>
        </div>
      </PageMetaProvider>
    );
  }

  if (inDesktopOs) {
    return (
      <PageMetaProvider>
        <div data-portal={user?.role}><Outlet /></div>
      </PageMetaProvider>
    );
  }

  return (
    <PageMetaProvider>
    {(isStudentShell || isStaffShell || isFacultyShell) && <PageMetaSync role={user?.role} onlyWithoutHeader={isStaffShell} />}
    <div data-portal={user?.role} className={`app-shell${insight ? ' app-shell--insight' : ''}${isStudentShell ? ' app-shell--student' : ''}${isStaffShell ? ' app-shell--staff' : ''}${isFacultyShell ? ` app-shell--student app-shell--${shellKind}` : ''}`}>
      <AmbientBackdrop />
      <Sidebar role={user?.role} user={user} isOpen={sidebarOpen} collapsed={collapsed} unread={unread} unreadMessages={unreadMessages} onClose={() => setSidebarOpen(false)} />

      {/* Mobile scrim — reuses .sidebar-overlay from responsive.css (only
          rendered/visible at the same breakpoint the off-canvas sidebar is). */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' is-visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <div className="app-shell__content">
        <Topbar
          role={user?.role}
          user={user}
          onMenuClick={toggleSidebar}
          collapsed={collapsed}
          onUnreadChange={setUnread}
          onLogout={logout}
        />

        <main className="app-shell__main" ref={mainRef} data-admin-page={adminPage}>
          {eyebrow && !isStudentShell && !isStaffShell && !isFacultyShell && !/\/messages\/?$/.test(pathname) && <div className="insight-eyebrow">{eyebrow}</div>}
          {blocked ? <NoPermission permission={navItem.perm} /> : <Outlet />}
        </main>
      </div>

      <BottomNav role={user?.role} unreadMessages={unreadMessages} unread={unread} onMoreClick={() => setSidebarOpen(true)} />

      {/* Mounted once per authenticated layout — same rule as
          layouts/footer.php's <?php if (Session::userId()): ?>
          [data-ai-assistant-root] — every portal that uses DashboardLayout
          gets the widget. */}
      {/* inside My PC the desktop mounts its own copy (this page is hidden under it) */}
      {user && can('ai.assistant_use') && !/\/my-pc(\/|$)/.test(pathname) && <AiAssistantWidget role={user.role} user={user} />}
    </div>
    </PageMetaProvider>
  );
}
