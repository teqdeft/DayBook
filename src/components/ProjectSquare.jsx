import styles from './ProjectSquare.module.css';

export const PROJECT_COLORS = ['blue', 'green', 'violet', 'orange', 'teal', 'pink'];

/** A stored project colour, or blue when it is missing or unknown. */
export function projectColor(color) {
  return PROJECT_COLORS.includes(color) ? color : 'blue';
}

/**
 * The project's first letter on a soft square of its colour. The design uses 42 px on the
 * project cards and 34 px in the projects table.
 */
export default function ProjectSquare({ project, size = 40, className, style, ...rest }) {
  const color = projectColor(project?.color);
  const letter = (String(project?.name ?? '').trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className={[styles.square, styles[color], className].filter(Boolean).join(' ')}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size * 0.43)}px`,
        borderRadius: `${Math.round(size * 0.25)}px`,
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    >
      {letter}
    </span>
  );
}
