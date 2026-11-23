'use client';
// The Leave page's Person filter (CONTRACT 25, item 9): "Everyone", then the tracked, active
// people the viewer may see, by name; kept in ?userId= with the month (the page starts at 1).
import { useId } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/Field';
import Select from '@/components/Select';
import styles from './page.module.css';

/**
 * @param {{ people: Array<{ id: number, name: string }>, userId: number | null,
 *   month: string }} props
 */
export default function LeaveFilter({ people, userId, month }) {
  const router = useRouter();
  const id = useId();

  function pick(event) {
    const query = new URLSearchParams({ month });
    if (event.target.value) query.set('userId', event.target.value);
    router.push(`/attendance/leave?${query}`, { scroll: false });
  }

  return (
    <div className={styles.filter}>
      <Field label="Person" htmlFor={`${id}-person`} className={styles.filterField}>
        <Select
          id={`${id}-person`}
          value={userId ? String(userId) : ''}
          onChange={pick}
          options={[
            { value: '', label: 'Everyone' },
            ...people.map((person) => ({ value: String(person.id), label: person.name })),
          ]}
        />
      </Field>
    </div>
  );
}
