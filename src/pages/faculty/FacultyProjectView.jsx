import ProjectReviewView from '../../components/university/ProjectReviewView';

/**
 * Mirrors app/Views/faculty/project-view.php — GET /api/v1/faculty/approvals/{id}
 * (FacultyApprovalsApiController::show()), reached from the FacultyApprovals
 * queue. Shares the um- design with UniversityProjectView via
 * components/university/ProjectReviewView.jsx; the faculty view leaves out the
 * Faculty and Supervisor rows, like the PHP view.
 */
export default function FacultyProjectView() {
  return <ProjectReviewView scope="faculty" />;
}
