import CoursesManager from '../../components/courses/CoursesManager';
import CourseRequestsInbox from '../../components/courses/CourseRequestsInbox';

export default function AcademicStaffCourses() {
  return (
    <>
      <div className="ex-page" style={{ paddingBottom: 0 }}><CourseRequestsInbox /></div>
      <CoursesManager role="academic_staff" />
    </>
  );
}
