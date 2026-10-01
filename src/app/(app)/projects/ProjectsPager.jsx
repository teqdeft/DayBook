// Previous / next links under the projects table when a tab has more than one page.
import Button from '@/components/Button';
import styles from './ManageProjectsView.module.css';

export default function ProjectsPager({ page, pageSize, total, prevHref, nextHref }) {
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav className={styles.pager} aria-label="Pages">
      <p className={styles.pagerText}>
        Showing {first}–{last} of {total}
      </p>
      <div className={styles.pagerButtons}>
        <Button
          variant="secondary"
          size="compact"
          href={prevHref ?? undefined}
          disabled={!prevHref}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="compact"
          href={nextHref ?? undefined}
          disabled={!nextHref}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
