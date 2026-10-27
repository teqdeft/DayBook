// My settings (CONTRACT 21): how Daybook looks and works for the signed-in person — the report's
// submit buttons, new task status, carry-over and Slack preview, the AI buttons, the bell,
// desktop notifications and the theme. Built like Settings (artboard 12): a section list on the
// left, one card per section. Every change saves at once. Any signed-in person.
import TopBar from '@/components/TopBar';
import { logger } from '@/lib/logger';
import { requireUser } from '@/lib/session';
import { ai } from '@/modules/ai';
import { preferences, preferencesFor } from '@/modules/preferences';
import { push } from '@/modules/push';
import { settings } from '@/modules/settings';
import MySettingsSections from './MySettingsSections';
import PreferencesProvider, { SaveStatus } from './PreferencesProvider';
import SectionNav from './SectionNav';
import { sectionsFor, writesReports as writesReportsFor } from './sections';
import styles from './page.module.css';

export const metadata = { title: 'My settings' };

async function safely(promise, fallback, message, userId) {
  try {
    return await promise;
  } catch (error) {
    logger.warn({ err: error, userId }, message);
    return fallback;
  }
}

export default async function MySettingsPage() {
  const user = await requireUser();
  const writesReports = writesReportsFor(user);
  // The page still opens when a read fails: the defaults, no AI section, no desktop switch.
  const [values, all, polishAvailable] = await Promise.all([
    safely(
      preferencesFor(user),
      preferences.PREFERENCE_DEFAULTS,
      'my settings: could not read preferences',
      user.id,
    ),
    safely(settings.getAll(), {}, 'my settings: could not load settings', user.id),
    writesReports
      ? safely(ai.isAvailable('polish'), false, 'my settings: could not check AI', user.id)
      : false,
  ]);
  // Desktop notifications (CONTRACT 14): only the public key goes to the browser, as for the bell.
  const publicKey = all?.pushEnabled === true ? push.publicKey() : null;
  const sections = sectionsFor({ writesReports, polishAvailable });

  return (
    <PreferencesProvider initial={{ ...values }}>
      {/* The save status sits at the top bar's right end without a row of its own (TopBar's
          actions would wrap under the title below 1024 px and leave an empty band). */}
      <div className={styles.head}>
        <TopBar title="My settings" subtitle="How Daybook looks and works for you" />
        <SaveStatus />
      </div>
      <div className={styles.layout}>
        <SectionNav sections={sections} />
        <MySettingsSections
          sections={sections.map((section) => section.id)}
          push={publicKey ? { publicKey, userId: user.id } : null}
        />
      </div>
    </PreferencesProvider>
  );
}
