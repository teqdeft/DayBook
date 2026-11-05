// The custom range picker on the project report and the projects table: two dates in a plain GET
// form, so it works without JavaScript and the range stays in the URL. Server-safe.
import Button from '@/components/Button';
import Card from '@/components/Card';
import Field from '@/components/Field';
import Input from '@/components/Input';
import styles from './RangeForm.module.css';

/**
 * A GET form replaces the whole query, so `keep` lists the URL parameters to carry over.
 * @param {{ action: string, from: string, to: string, max: string,
 *   errors?: { from?: string, to?: string, range?: string } | null,
 *   keep?: Record<string, string> }} props
 */
export default function RangeForm({ action, from, to, max, errors, keep }) {
  return (
    <Card padding="compact" className={styles.card}>
      <form action={action} method="get" className={styles.form} noValidate>
        {Object.entries(keep ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="range" value="custom" />
        <p className={styles.title}>Custom range</p>
        <Field
          label="From"
          htmlFor="project-range-from"
          error={errors?.from ?? errors?.range}
          className={styles.field}
        >
          <Input
            id="project-range-from"
            name="from"
            type="date"
            compact
            defaultValue={from}
            max={max}
            required
            error={Boolean(errors?.from ?? errors?.range)}
          />
        </Field>
        <Field label="To" htmlFor="project-range-to" error={errors?.to} className={styles.field}>
          <Input
            id="project-range-to"
            name="to"
            type="date"
            compact
            defaultValue={to}
            required
            error={Boolean(errors?.to)}
          />
        </Field>
        <Button type="submit" variant="secondary" size="compact" className={styles.submit}>
          Show
        </Button>
      </form>
    </Card>
  );
}
