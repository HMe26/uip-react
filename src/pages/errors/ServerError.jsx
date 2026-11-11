import { useLanguage } from '../../context/LanguageContext';
import Icon from '../../components/Icon';
import ErrorPage from './ErrorPage';

/** 500 — something broke on our end, not the visitor's. `onRetry` lets the ErrorBoundary offer a reload instead of "Browse projects". */
export default function ServerError({ onRetry }) {
  const { locale } = useLanguage();
  const isAr = locale === 'ar';
  const t = (en, ar) => (isAr ? ar : en);

  return (
    <ErrorPage
      code={500}
      statusKey="SERVER_ERROR"
      showPath={!onRetry}
      title={t('Something broke on our end.', 'حصلت مشكلة من عندنا.')}
      desc={t(
        "This isn't something you did. Try again in a moment — if it keeps happening, let us know what you were doing when it broke.",
        'المشكلة دي مش منك. جرّب تاني بعد شوية — لو استمرت، قولّنا كنت بتعمل إيه لما حصلت.'
      )}
      primaryAction={
        <button type="button" className="btn btn-primary" onClick={onRetry || (() => window.location.reload())}>
          <Icon name="refresh" size={16} />
          {t('Try again', 'إعادة المحاولة')}
        </button>
      }
    />
  );
}
