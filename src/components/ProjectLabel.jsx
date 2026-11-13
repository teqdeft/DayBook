import { ChevronDown } from 'lucide-react';
import { projectColorStyle } from '@/lib/projectColors';
import { projectColor } from './ProjectSquare';
import styles from './ProjectLabel.module.css';

export { default as ProjectSquare, PROJECT_COLORS, projectColor } from './ProjectSquare';

const SIZE_CLASS = { sm: styles.sm, md: styles.md, lg: styles.lg };

/**
 * Project name on a soft background in the project's colour (26 px, 6 px radius). `lg` with
 * as="button" and `chevron` is the Daily report's project picker. A custom colour arrives as
 * --project, merged with the caller's `style`.
 */
export default function ProjectLabel({
  project,
  size = 'md',
  as = 'span',
  chevron = false,
  className,
  style,
  children,
  ...rest
}) {
  const Tag = as;
  const color = projectColor(project?.color);
  const classes = [styles.label, SIZE_CLASS[size] ?? styles.md, styles[color], className]
    .filter(Boolean)
    .join(' ');
  const buttonProps = Tag === 'button' ? { type: 'button' } : {};
  return (
    <Tag
      className={classes}
      style={{ ...projectColorStyle(project?.color), ...style }}
      {...buttonProps}
      {...rest}
    >
      <span className={styles.name}>{children ?? project?.name}</span>
      {chevron ? (
        <ChevronDown className={styles.chevron} size={14} strokeWidth={1.8} aria-hidden="true" />
      ) : null}
    </Tag>
  );
}
