import { useState } from 'react';
import { api, errorMessage } from '../../../api/client';
import Icon from '../../Icon';
import { BASE, useL } from './shared';

const ERR = {
  missing: ['Fill in the required fields for this provider first.', 'كمّل الحقول المطلوبة للمزوّد ده الأول.'],
  http_401: ['The provider rejected the key (401).', 'المزوّد رفض المفتاح (401).'],
  http_403: ['The provider refused the request (403). Check the key, or that json is enabled for SearXNG.', 'المزوّد رفض الطلب (403). راجع المفتاح، أو إن json متفعّل في SearXNG.'],
  http_429: ['Quota used up or too many requests (429).', 'الحصة خلصت أو طلبات كتير (429).'],
  unreachable: ['Could not reach the provider. Check the address and that it is running.', 'مقدرتش أوصل للمزوّد. راجع العنوان وإنه شغّال.'],
};

/** "Test search" button for the Search & browser tab. Tests the values on screen (even unsaved); an empty key box means the saved key. */
export default function SearchTestPanel({ val, draft, data }) {
  const { ar, L } = useL();
  const [q, setQ] = useState('Cairo University');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');

  async function run() {
    setBusy(true); setErr(''); setRes(null);
    try {
      const j = await api.post(`${BASE}/search/test`, {
        q, provider: val('web_search_provider'), url: val('web_search_url'), cx: val('web_search_cx'), key: draft.web_search_key || '',
      });
      setRes(j.data);
    } catch (e) { setErr(errorMessage(e)); }
    setBusy(false);
  }

  const errText = (c) => (ERR[c] ? ERR[c][ar ? 1 : 0] : c);
  return (
    <div className="dvc-searchtest">
      <div className="mtc-inline">
        <input className="form-input" dir="auto" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder={L('Test query', 'كلمة للتجربة')} />
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={run}><Icon name="search" size={14} /> {busy ? '…' : L('Test search', 'جرّب البحث')}</button>
      </div>
      <small className="mtc-muted">
        {data?.search?.configured ? L('Search is set up and live for users.', 'البحث متظبط وشغّال للمستخدمين.') : L('Search is not set up yet — users see a “search is not set up” note.', 'البحث لسه مش متظبط — المستخدمين بيشوفوا رسالة "البحث مش متظبط".')}
        {' '}{L('The test uses the values on screen, even before you save.', 'التجربة بتستخدم القيم الظاهرة حتى قبل الحفظ.')}
      </small>
      {err && <div className="st-alert st-alert--danger mtc-banner"><Icon name="alert-triangle" size={16} /><span>{err}</span></div>}
      {res && (
        <div className={`st-alert ${res.ok && res.count ? 'st-alert--success' : 'st-alert--danger'} mtc-banner`} role="status">
          <Icon name={res.ok && res.count ? 'check' : 'alert-triangle'} size={16} />
          <span>
            {res.ok
              ? (res.count ? L(`Works — ${res.count} results in ${res.ms} ms.`, `شغّال — ${res.count} نتايج في ${res.ms} ms.`) : L('The provider answered but returned no results.', 'المزوّد رد بس من غير نتايج.'))
              : errText(res.error)}
            {res.ok && (res.results || []).map((r) => <div key={r.url} dir="ltr" className="mtc-muted">{r.title} — {r.domain}</div>)}
          </span>
        </div>
      )}
    </div>
  );
}
