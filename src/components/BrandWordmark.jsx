/**
 * The UIPE wordmark. Renders the colour logo for light surfaces and a light variant (silver letters, same gold swoosh)
 * for dark ones; CSS (brand-logo.css) picks by theme, or always the light variant when `onDark` is set.
 */
export default function BrandWordmark({ className = '', width = 100, height = 39, onDark = false, alt = 'UIPE' }) {
  const set = (light) => (light
    ? { src: '/images/logo/uipe-wordmark-light-sm.png', srcSet: '/images/logo/uipe-wordmark-light-sm.png 1x, /images/logo/uipe-wordmark-light.png 2x' }
    : { src: '/images/logo/uipe-wordmark-sm.png', srcSet: '/images/logo/uipe-wordmark-sm.png 1x, /images/logo/uipe-wordmark.png 2x' });
  return (
    <span className={`bw${onDark ? ' bw--dark' : ''} ${className}`} style={{ aspectRatio: `${width} / ${height}`, width }}>
      {!onDark && <img className="bw__on-light" {...set(false)} alt={alt} width={width} height={height} decoding="async" />}
      <img className="bw__on-dark" {...set(true)} alt={onDark ? alt : ''} width={width} height={height} decoding="async" />
    </span>
  );
}
