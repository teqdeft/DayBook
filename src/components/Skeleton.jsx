import styles from './Skeleton.module.css';

function toCss(value) {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

/**
 * Grey placeholder block for loading states; size it like the real content. In a flex row a bar
 * shrinks when the row is too narrow; a square or circle (number width equal to height) doesn't.
 */
export default function Skeleton({
  width = '100%',
  height = 16,
  radius = 6,
  className,
  style,
  ...rest
}) {
  const fixed = typeof width === 'number' && width === height;
  return (
    <span
      className={[styles.skeleton, fixed ? styles.fixed : null, className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: toCss(width), height: toCss(height), borderRadius: toCss(radius), ...style }}
      aria-hidden="true"
      {...rest}
    />
  );
}
