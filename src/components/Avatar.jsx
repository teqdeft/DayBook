import { avatarTone, initials as initialsOf } from '@/lib/text';
import styles from './Avatar.module.css';

const TONES = new Set([
  'blue',
  'violet',
  'green',
  'teal',
  'orange',
  'red',
  'pink',
  'navy',
  'ink',
  'grey',
]);

// Quotes, backslashes and line breaks would end the CSS url("...") early.
function cssUrl(value) {
  return `url("${String(value).replace(/["\\\n\r]/g, (char) => encodeURIComponent(char))}")`;
}

function fontSizeFor(size) {
  if (size <= 24) return 10;
  if (size <= 30) return 11;
  if (size <= 38) return 13;
  if (size <= 48) return 14;
  return Math.round(size * 0.34);
}

/**
 * Round avatar: the Slack photo when there is one, otherwise initials on a soft tint
 * (navy and ink tints are solid). 34 px in tables, 38 px in the sidebar, 64 px on a profile.
 * Decorative by default (the name sits next to it); pass `label` when it stands alone.
 * shape="square" gives the rounded-square Slack preview avatar.
 */
export default function Avatar({
  user,
  size = 34,
  tone,
  shape = 'circle',
  label,
  className,
  style: styleProp,
  ...rest
}) {
  const toneName = TONES.has(tone) ? tone : avatarTone(user);
  const text = user?.initials || initialsOf(user?.name);
  const photo = user?.avatarUrl;
  const classes = [
    styles.avatar,
    styles[toneName],
    shape === 'square' ? styles.square : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const style = {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${fontSizeFor(size)}px`,
    ...(photo ? { backgroundImage: cssUrl(photo) } : null),
    ...styleProp,
  };
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <span className={classes} style={style} {...a11y} {...rest}>
      {photo ? null : text}
    </span>
  );
}

/** Overlapping avatars (project cards and the projects table); extra people show as "+N". */
export function AvatarStack({ users = [], max = 4, size = 30, className, ...rest }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  const names = users
    .map((person) => person?.name)
    .filter(Boolean)
    .join(', ');
  return (
    <span
      className={[styles.stack, className].filter(Boolean).join(' ')}
      role={names ? 'img' : undefined}
      aria-label={names || undefined}
      {...rest}
    >
      {shown.map((person, index) => (
        <Avatar
          key={person?.id ?? `${person?.name}-${index}`}
          user={person}
          size={size}
          className={styles.stacked}
        />
      ))}
      {extra > 0 ? (
        <span
          className={[styles.avatar, styles.grey, styles.stacked, styles.more].join(' ')}
          style={{ width: `${size}px`, height: `${size}px`, fontSize: `${fontSizeFor(size)}px` }}
          aria-hidden="true"
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
