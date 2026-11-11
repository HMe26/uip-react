import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import Icon from '../Icon';
import { useLanguage } from '../../context/LanguageContext';

/**
 * مواعيد تسليم ومناقشة مشاريع التخرج — للجامعة (موعد عام) وللكلية (موعد خاص بيتقدّم على العام).
 * GET/POST/DELETE /api/v1/project-deadlines
 */
export default function DeadlinesCard({ scopeLabel }) {
  const { locale } = useLanguage();
  const ar = locale === 'ar';
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', submission_deadline: '', defense_starts_at: '', defense_ends_at: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get('/api/v1/project-deadlines').then((r) => setItems(r?.data?.items || [])).catch(() => setItems([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/api/v1/project-deadlines', form);
      setForm({ title: '', submission_deadline: '', defense_starts_at: '', defense_ends_at: '' });
      setOpen(false); load();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!window.confirm(ar ? 'حذف هذا الموعد؟' : 'Delete this deadline?')) return;
    try { await api.delete(`/api/v1/project-deadlines/${id}`); load(); } catch (err) { setError(errorMessage(err)); }
  }

  const fmt = (v) => (v ? new Date(v.replace(' ', 'T')).toLocaleString(ar ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: v.length > 10 ? 'short' : undefined }) : '—');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section className="um-panel" style={{ marginBottom: 16 }}>
      <div className="um-panel__head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{ar ? 'مواعيد التسليم والمناقشة' : 'Submission & defense deadlines'} {scopeLabel ? `(${scopeLabel})` : ''}</h2>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen((v) => !v)}><Icon name="plus" size={14} /> {ar ? 'موعد جديد' : 'New deadline'}</button>
      </div>
      {error && <p className="um-panel__sub" style={{ color: 'var(--danger, #c0392b)' }}>{error}</p>}
      {open && (
        <form onSubmit={save} style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <input className="form-input" required placeholder={ar ? 'العنوان (مثال: تسليم مشاريع التخرج - الفصل الثاني)' : 'Title'} value={form.title} onChange={set('title')} />
          <label className="um-panel__sub">{ar ? 'آخر موعد للتسليم' : 'Submission deadline'}<input className="form-input" type="datetime-local" value={form.submission_deadline} onChange={set('submission_deadline')} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="um-panel__sub">{ar ? 'بداية المناقشات' : 'Defense starts'}<input className="form-input" type="date" value={form.defense_starts_at} onChange={set('defense_starts_at')} /></label>
            <label className="um-panel__sub">{ar ? 'نهاية المناقشات' : 'Defense ends'}<input className="form-input" type="date" value={form.defense_ends_at} onChange={set('defense_ends_at')} /></label>
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy} style={{ justifySelf: 'start' }}>{ar ? 'حفظ' : 'Save'}</button>
        </form>
      )}
      {items.length === 0 ? (
        <p className="um-panel__sub">{ar ? 'لا توجد مواعيد محددة — التقديم مفتوح بدون موعد نهائي.' : 'No deadlines set — submissions are open with no cut-off.'}</p>
      ) : items.map((d) => (
        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
          <span>
            <strong>{d.title}</strong>
            <span className="um-panel__sub" style={{ display: 'block' }}>
              {ar ? 'التسليم: ' : 'Due: '}{fmt(d.submission_deadline)} · {ar ? 'المناقشة: ' : 'Defense: '}{fmt(d.defense_starts_at)} → {fmt(d.defense_ends_at)}
            </span>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(d.id)} aria-label="delete"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </section>
  );
}
