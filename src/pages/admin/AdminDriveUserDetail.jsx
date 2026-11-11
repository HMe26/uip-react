import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import UserDetail from '../../components/admin/driveControl/UserDetail';
import { observeTables } from '../../lib/labelTables';

/** Admin → My PC Control → one user (/admin/drive-control/users/:id). Full responsive page; tables turn into cards on phones. */
export default function AdminDriveUserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { key } = useLocation();
  const ref = useRef(null);
  useEffect(() => (ref.current ? observeTables(ref.current) : undefined), [id]);
  const back = () => (key !== 'default' ? navigate(-1) : navigate('/admin/drive-control?tab=users', { replace: true }));
  return (
    <div className="sa-page ap-page" ref={ref}>
      <UserDetail key={id} uid={Number(id)} onClose={back} />
    </div>
  );
}
