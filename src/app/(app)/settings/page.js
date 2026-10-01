// Settings (artboard 12): company, office hours and reports, check-in networks and switches,
// Slack, screen time and desktop notifications. One "Save changes" saves every section. Admin
// only.
import { headers } from 'next/headers';
import TopBar from '@/components/TopBar';
import { logger } from '@/lib/logger';
import { clientIp } from '@/lib/route';
import { requirePage } from '@/lib/session';
import { nowDate } from '@/lib/time';
import { push } from '@/modules/push';
import { settings } from '@/modules/settings';
import { slack } from '@/modules/slack';
import { reportLockOptions, timezoneOptions } from './options';
import SettingsForm from './SettingsForm';
import SettingsNav from './SettingsNav';
import SettingsProvider, { SaveSettingsButton } from './SettingsProvider';
import styles from './page.module.css';

export const metadata = { title: 'Settings' };

async function slackConnection() {
  try {
    return await slack.getConnection();
  } catch (error) {
    logger.warn({ err: error }, 'settings: could not check the Slack connection');
    return { configured: slack.isConfigured(), connected: false, teamName: null };
  }
}

export default async function SettingsPage() {
  await requirePage('settings.manage');
  const [values, networks, connection, requestHeaders] = await Promise.all([
    settings.getAll(),
    settings.listOfficeNetworks(),
    slackConnection(),
    headers(),
  ]);

  return (
    <SettingsProvider initial={values}>
      <TopBar
        title="Settings"
        subtitle="Company-wide rules for Daybook"
        actions={<SaveSettingsButton />}
      />
      <div className={styles.layout}>
        <SettingsNav />
        <SettingsForm
          timezones={timezoneOptions(values.timezone, nowDate())}
          reportLocks={reportLockOptions(values.reportLock)}
          networks={networks.map(({ id, name, ipAddress }) => ({ id, name, ipAddress }))}
          currentIp={clientIp({ headers: requestHeaders })}
          connection={connection}
          pushConfigured={push.isConfigured()}
        />
      </div>
    </SettingsProvider>
  );
}
