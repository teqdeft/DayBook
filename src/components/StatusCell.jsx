import { ChevronDown } from 'lucide-react';
import styles from './StatusCell.module.css';

export const STATUS_LABELS = {
  done: 'Done',
  in_progress: 'In progress',
  blocked: 'Blocked',
  submitted: 'Submitted',
  approved: 'Approved',
  created: 'Created',
  active: 'Active',
  connected: 'Connected',
  office: 'Office',
  missing: 'Missing',
  urgent: 'Urgent',
  pending: 'Pending',
  edit_requested: 'Edit requested',
  unverified: 'Unverified',
  wfh: 'WFH',
  edited: 'Edited',
  locked: 'Locked',
  on_hold: 'On hold',
  declined: 'Declined',
  not_checked_in: 'Not checked in',
  deactivated: 'Deactivated',
  completed: 'Completed',
  draft: 'Draft',
};

const STATUS_FILL = {
  done: 'green',
  submitted: 'green',
  approved: 'green',
  created: 'green',
  active: 'green',
  connected: 'green',
  in_progress: 'primary',
  office: 'primary',
  blocked: 'red',
  missing: 'red',
  urgent: 'marigold',
  pending: 'marigold',
  edit_requested: 'marigold',
  unverified: 'marigold',
  wfh: 'violet',
  edited: 'violet',
};

const SIZE_CLASS = {
  cell: styles.cell,
  cellCompact: styles.cellCompact,
  cellLarge: styles.cellLarge,
  pill: styles.pill,
  block: styles.block,
};

/**
 * Filled status block with words (never colour alone). `cell` is 34 px and fills its column,
 * `cellCompact` 30 px, `cellLarge` 38 px (the report's status select), `pill` the 29 px badge on
 * cards, `block` the 30 px label that sizes to its word (Overview's "Missing" / "Pending").
 * as="button" plus chevron makes it the status picker on the Daily report.
 */
export default function StatusCell({
  status,
  label,
  size = 'cell',
  chevron = false,
  as = 'div',
  className,
  ...rest
}) {
  const fill = STATUS_FILL[status] ?? 'neutral';
  const Tag = as === 'button' ? 'button' : as === 'span' ? 'span' : 'div';
  const classes = [styles.status, SIZE_CLASS[size] ?? styles.cell, styles[fill], className]
    .filter(Boolean)
    .join(' ');
  const text = label ?? STATUS_LABELS[status] ?? String(status ?? '');
  const buttonProps = Tag === 'button' ? { type: 'button' } : {};
  return (
    <Tag className={classes} data-status={status} {...buttonProps} {...rest}>
      <span className={styles.text}>{text}</span>
      {chevron ? (
        <ChevronDown className={styles.chevron} size={16} strokeWidth={1.8} aria-hidden="true" />
      ) : null}
    </Tag>
  );
}
