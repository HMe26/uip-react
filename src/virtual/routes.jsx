import { lazy } from 'react';

/**
 * The student pages a window of the virtual mode can show. Same lazy imports as App.jsx (so Vite shares the chunks),
 * kept here as plain data: { path, element }. Generated from App.jsx's student <Route>s — add a page here when you add a student route.
 * NOT listed on purpose: /student/exam-attempt/:id (the exam itself is a full-screen, locked-down page — see catalog.js).
 */
const CourseContentPage = lazy(() => import('../pages/courses/CourseContentPage'));
const MeetingCalendar = lazy(() => import('../pages/meetings/MeetingCalendar'));
const MeetingDetails = lazy(() => import('../pages/meetings/MeetingDetails'));
const Messages = lazy(() => import('../pages/Messages'));
const MessagesRoute = lazy(() => import('../pages/MessagesRoute'));
const MyMeetings = lazy(() => import('../pages/meetings/MyMeetings'));
const Notifications = lazy(() => import('../pages/Notifications'));
const PortalGuide = lazy(() => import('../pages/guide/PortalGuide'));
const StudentAIAnalysis = lazy(() => import('../pages/student/StudentAIAnalysis'));
const StudentAcademicCalendar = lazy(() => import('../pages/student/StudentAcademicCalendar'));
const StudentAdminRequests = lazy(() => import('../pages/student/StudentAdminRequests'));
const StudentAnnouncements = lazy(() => import('../pages/student/StudentAnnouncements'));
const StudentAssignments = lazy(() => import('../pages/student/StudentAssignments'));
const StudentAttendance = lazy(() => import('../pages/student/StudentAttendance'));
const StudentContacts = lazy(() => import('../pages/student/StudentContacts'));
const StudentCourses = lazy(() => import('../pages/student/StudentCourses'));
const StudentDashboard = lazy(() => import('../pages/student/StudentDashboard'));
const StudentDiscovery = lazy(() => import('../pages/student/StudentDiscovery'));
const StudentExamDetail = lazy(() => import('../pages/student/StudentExamDetail'));
const StudentExamResult = lazy(() => import('../pages/student/StudentExamResult'));
const StudentFeed = lazy(() => import('../pages/student/StudentFeed'));
const StudentFees = lazy(() => import('../pages/student/StudentFees'));
const StudentGitHub = lazy(() => import('../pages/student/StudentGitHub'));
const StudentGrades = lazy(() => import('../pages/student/StudentGrades'));
const StudentGraduation = lazy(() => import('../pages/student/StudentGraduation'));
const StudentGroupChat = lazy(() => import('../pages/student/StudentGroupChat'));
const StudentGroupHub = lazy(() => import('../pages/student/StudentGroupHub'));
const StudentMyExams = lazy(() => import('../pages/student/StudentMyExams'));
const StudentPatents = lazy(() => import('../pages/student/StudentPatents'));
const StudentPortfolio = lazy(() => import('../pages/student/StudentPortfolio'));
const StudentProfile = lazy(() => import('../pages/student/StudentProfile'));
const StudentProjectCreate = lazy(() => import('../pages/student/StudentProjectCreate'));
const StudentProjectDetail = lazy(() => import('../pages/student/StudentProjectDetail'));
const StudentProjectEdit = lazy(() => import('../pages/student/StudentProjectEdit'));
const StudentProjects = lazy(() => import('../pages/student/StudentProjects'));
const StudentRegistration = lazy(() => import('../pages/student/StudentRegistration'));
const StudentSettings = lazy(() => import('../pages/student/StudentSettings'));
const StudentSummer = lazy(() => import('../pages/student/StudentSummer'));
const StudentTimetable = lazy(() => import('../pages/student/StudentTimetable'));
const StudentUniversityEmail = lazy(() => import('../pages/student/StudentUniversityEmail'));

export const VM_ROUTES = [
  { path: '/student/dashboard', element: <StudentDashboard /> },
  { path: '/student/courses', element: <StudentCourses /> },
  { path: '/student/timetable', element: <StudentTimetable /> },
  { path: '/student/academic-calendar', element: <StudentAcademicCalendar /> },
  { path: '/student/attendance', element: <StudentAttendance /> },
  { path: '/student/assignments', element: <StudentAssignments /> },
  { path: '/student/grades', element: <StudentGrades /> },
  { path: '/student/registration', element: <StudentRegistration /> },
  { path: '/student/admin-requests', element: <StudentAdminRequests /> },
  { path: '/student/summer', element: <StudentSummer /> },
  { path: '/student/fees', element: <StudentFees /> },
  { path: '/student/university-email', element: <StudentUniversityEmail /> },
  { path: '/student/courses/:id/content', element: <CourseContentPage role="student" /> },
  { path: '/student/my-exams', element: <StudentMyExams /> },
  { path: '/student/my-exams/:id', element: <StudentExamDetail /> },
  { path: '/student/exam-attempt/:id/result', element: <StudentExamResult /> },
  { path: '/student/profile', element: <StudentProfile /> },
  { path: '/student/feed', element: <StudentFeed /> },
  { path: '/student/announcements', element: <StudentAnnouncements /> },
  { path: '/student/group-hub', element: <StudentGroupHub /> },
  { path: '/student/contacts', element: <StudentContacts /> },
  { path: '/student/portfolio', element: <StudentPortfolio /> },
  { path: '/student/graduation', element: <StudentGraduation /> },
  { path: '/student/group-chat', element: <StudentGroupChat /> },
  { path: '/student/patents', element: <StudentPatents /> },
  { path: '/student/projects', element: <StudentProjects /> },
  { path: '/student/projects/create', element: <StudentProjectCreate /> },
  { path: '/student/projects/:id', element: <StudentProjectDetail /> },
  { path: '/student/projects/:id/edit', element: <StudentProjectEdit /> },
  { path: '/student/ai-analysis', element: <StudentAIAnalysis /> },
  { path: '/student/discovery', element: <StudentDiscovery /> },
  { path: '/student/github', element: <StudentGitHub /> },
  { path: '/student/settings', element: <StudentSettings /> },
  { path: '/student/messages', element: <Messages /> },
  { path: '/student/messages/:conversationId', element: <MessagesRoute /> },
  { path: '/student/notifications', element: <Notifications /> },
  { path: '/student/meetings', element: <MyMeetings /> },
  { path: '/student/meetings/calendar', element: <MeetingCalendar /> },
  { path: '/student/meetings/:uuid', element: <MeetingDetails /> },
  { path: '/student/guide', element: <PortalGuide /> },
];
