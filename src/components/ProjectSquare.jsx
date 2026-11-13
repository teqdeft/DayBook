import { PROJECT_COLORS, projectColorKey, projectColorStyle } from '@/lib/projectColors';
import styles from './ProjectSquare.module.css';

export { PROJECT_COLORS };

/**
 * The class key of a stored project colour: the preset's name, 'custom' for a custom '#rrggbb'
 * (CONTRACT 23), or blue when it is missing or unknown.
 */
export function projectColor(color) {
  return projectColorKey(color);
}

/**
 * The project's first letter on a soft square of its colour. The design uses 42 px on the
 * project cards and 34 px in the projects table. A custom colour arrives as --project.
 */
export default function ProjectSquare({ project, size = 40, className, style, ...rest }) {
  const color = projectColor(project?.color);
  const letter = (String(project?.name ?? '').trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className={[styles.square, styles[color], className].filter(Boolean).join(' ')}
      style={{
        ...projectColorStyle(project?.color),
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
