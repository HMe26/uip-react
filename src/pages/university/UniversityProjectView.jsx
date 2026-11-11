import ProjectReviewView from '../../components/university/ProjectReviewView';

/**
 * Mirrors app/Views/university/project-view.php — GET /api/v1/university/approvals/{id}
 * (UniversityApprovalsApiController::show()), reached from the UniversityApprovals
 * queue. Same um- design as the faculty view, via
 * components/university/ProjectReviewView.jsx (adds the Faculty + Supervisor rows).
 */
export default function UniversityProjectView() {
  return <ProjectReviewView scope="university" />;
}
