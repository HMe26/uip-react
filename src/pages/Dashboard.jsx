import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api, ApiError } from '../api/client';

// Each role's "me" endpoint lives at a different prefix in routes/api.php
// (/api/v1/universities/me, ...). This is a stand-in
// map for the pilot — swap in the real ones as each portal gets converted.
const ME_ENDPOINT = {
  university: '/api/v1/universities/me',
};

export default function Dashboard() {
  const { user } = useAuth();
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const endpoint = ME_ENDPOINT[user?.role];
    if (!endpoint) {
      setLoading(false);
      return;
    }
    api
      .get(endpoint)
      .then((json) => setProfile(json.data))
      .catch((err) => setError(err instanceof ApiError ? err.message : (ar ? 'تعذّر تحميل البيانات.' : 'Failed to load profile.')))
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <>
      <div className="page-header animate-rise-in">
        <div className="page-header__title">
          <p className="text-caption" style={{ margin: 0 }}>{ar ? 'تم تسجيل الدخول كـ' : 'Signed in as'}</p>
          <h1 className="text-h1">{user?.role} #{user?.id}</h1>
        </div>
      </div>


      <div className="card" style={{ marginTop: 'var(--space-5)' }}>
        {loading && <p>{ar ? 'جارٍ تحميل البيانات…' : 'Loading profile…'}</p>}
        {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
        {!loading && !error && profile && (
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(profile, null, 2)}</pre>
        )}
        {!loading && !error && !profile && (
          <p className="text-small" style={{ color: 'var(--text-secondary)' }}>
            No /me endpoint wired up yet for role "{user?.role}" — this page is the pilot,
            wire the real dashboard cards in here next (see university/dashboard.php for the
            reference layout: KPI cards, Recently Published, Recently Saved, Startup Potential).
          </p>
        )}
      </div>
    </>
  );
}
