// One settings card: title, one line of help, then its fields. Sections are scroll targets for
// the sub-navigation.
import Card, { CardHeader } from '@/components/Card';
import styles from './SettingsForm.module.css';

/** @param {{ id: string, title: string, subtitle: string, children: import('react').ReactNode }} props */
export default function Section({ id, title, subtitle, children }) {
  return (
    <Card
      as="section"
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className={styles.section}
    >
      <CardHeader
        title={<span id={`${id}-title`}>{title}</span>}
        subtitle={subtitle}
        className={styles.sectionHeader}
      />
      <div className={styles.sectionBody}>{children}</div>
    </Card>
  );
}
