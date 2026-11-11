import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import MeetingDetail from '../../components/admin/meetingsControl/MeetingDetail';
import { observeTables } from '../../lib/labelTables';

/**
 * Admin → Meetings Control → one meeting, on its own page (/admin/meetings-control/:uuid).
 * Same panel as before, but a full responsive page instead of a side drawer; tables turn into cards on phones.
 */
export default function AdminMeetingControlDetail() {
  const { uuid } = useParams();
  const navigate = useNavigate();
  const { key } = useLocation();
  const ref = useRef(null);
  useEffect(() => (ref.current ? observeTables(ref.current) : undefined), [uuid]);
  const back = () => (key !== 'default' ? navigate(-1) : navigate('/admin/meetings-control?tab=meetings', { replace: true }));
  return (
    <div className="sa-page ap-page" ref={ref}>
      <MeetingDetail key={uuid} uuid={uuid} onClose={back} />
    </div>
  );
}
