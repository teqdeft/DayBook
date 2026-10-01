// Data table used by every list screen. Server-safe (no hooks): pages pass `render(row)` functions
// from Server Components, or use it inside a Client Component (for example for group toggles).
// Below 1024 px each row becomes a stacked card; cells show their column label (data-label).
import { ChevronDown } from 'lucide-react';
import { plural } from '@/lib/text';
import { resolveTextColor } from './chartColors';
import styles from './DataTable.module.css';

/**
 * @typedef {{
 *   key: string, header?: import('react').ReactNode, label?: string, width?: number|string,
 *   align?: 'left'|'center'|'right', render?: (row: any, index: number) => import('react').ReactNode,
 *   className?: string, hideOnMobile?: boolean,
 * }} Column
 * @typedef {{
 *   key: string, title: import('react').ReactNode, tone?: string, count?: number|string,
 *   rows: any[], collapsed?: boolean, onToggle?: () => void, footer?: import('react').ReactNode,
 * }} Group
 */

/**
 * @param {{
 *   columns: Column[], rows?: any[], rowKey?: string | ((row: any) => string|number),
 *   groups?: Group[], empty?: import('react').ReactNode, dense?: boolean,
 *   headerVariant?: 'default'|'compact', caption?: string, className?: string,
 *   rowClassName?: (row: any) => string | undefined,
 * }} props
 *   `groups` (Team board) replaces `rows`. `dense` is the shorter table on Today (37 px header,
 *   51 px rows).
 *   `headerVariant` defaults to 'compact' (the slim header on the Team board) when groups are used.
 */
export default function DataTable({
  columns,
  rows = [],
  rowKey = 'id',
  groups,
  empty = null,
  dense = false,
  headerVariant,
  caption,
  className = '',
  rowClassName,
}) {
  const variant = headerVariant ?? (groups ? 'compact' : 'default');
  const isEmpty = groups ? groups.every((g) => g.rows.length === 0 && !g.count) : rows.length === 0;
  const tableClass = [
    styles.table,
    dense ? styles.dense : '',
    variant === 'compact' ? styles.compactHead : '',
    groups ? styles.grouped : '',
  ].join(' ');

  return (
    <div className={`${styles.wrap} ${className}`}>
      <table className={tableClass}>
        {caption ? <caption className="visually-hidden">{caption}</caption> : null}
        <colgroup>
          {columns.map((col) => (
            <col key={col.key} style={col.width !== undefined ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`${alignClass(col.align)} ${col.hideOnMobile ? styles.hideOnMobile : ''}`}
              >
                {col.header ?? col.label ?? ''}
              </th>
            ))}
          </tr>
        </thead>
        {isEmpty && empty ? (
          <tbody>
            <tr className={styles.emptyRow}>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          </tbody>
        ) : groups ? (
          groups.map((group) => (
            <GroupBody
              key={group.key}
              group={group}
              columns={columns}
              rowKey={rowKey}
              rowClassName={rowClassName}
            />
          ))
        ) : (
          <tbody>
            <Rows rows={rows} columns={columns} rowKey={rowKey} rowClassName={rowClassName} />
          </tbody>
        )}
      </table>
    </div>
  );
}

function GroupBody({ group, columns, rowKey, rowClassName }) {
  const color = resolveTextColor(group.tone);
  const count =
    typeof group.count === 'number'
      ? `${group.count} ${plural(group.count, 'person', 'people')}`
      : group.count;
  const title = (
    <>
      <ChevronDown
        className={`${styles.groupChevron} ${group.collapsed ? styles.collapsed : ''}`}
        size={18}
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <span className={styles.groupTitle}>{group.title}</span>
      {count !== undefined && count !== null ? (
        <span className={styles.groupCount}>{count}</span>
      ) : null}
    </>
  );
  return (
    <tbody className={styles.group} style={{ '--group-color': color }}>
      <tr className={styles.groupRow}>
        <th colSpan={columns.length} scope="rowgroup">
          {group.onToggle ? (
            <button
              type="button"
              className={styles.groupToggle}
              onClick={group.onToggle}
              aria-expanded={!group.collapsed}
            >
              {title}
            </button>
          ) : (
            <span className={styles.groupToggle}>{title}</span>
          )}
        </th>
      </tr>
      {group.collapsed ? null : (
        <Rows rows={group.rows} columns={columns} rowKey={rowKey} rowClassName={rowClassName} />
      )}
      {!group.collapsed && group.footer ? (
        <tr className={styles.groupFooter}>
          <td colSpan={columns.length}>{group.footer}</td>
        </tr>
      ) : null}
    </tbody>
  );
}

function Rows({ rows, columns, rowKey, rowClassName }) {
  return rows.map((row, index) => (
    <tr
      key={typeof rowKey === 'function' ? rowKey(row) : (row[rowKey] ?? index)}
      className={rowClassName?.(row) ?? undefined}
    >
      {columns.map((col) => (
        <td
          key={col.key}
          data-label={col.label ?? (typeof col.header === 'string' ? col.header : undefined)}
          className={`${alignClass(col.align)} ${col.className ?? ''} ${col.hideOnMobile ? styles.hideOnMobile : ''}`}
        >
          <div className={styles.cell}>
            {col.render ? col.render(row, index) : (row[col.key] ?? '')}
          </div>
        </td>
      ))}
    </tr>
  ));
}

function alignClass(align) {
  if (align === 'right') return styles.right;
  if (align === 'center') return styles.center;
  return '';
}
