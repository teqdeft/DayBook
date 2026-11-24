// Settings (artboard 12): company, office hours and reports, check-in networks and switches,
// attendance marks and HR updates (CONTRACT 25), Slack, screen time, timers and breaks, desktop
// notifications, AI and files (CONTRACT 27). One "Save changes" saves every section. Admin only.
import { headers } from 'next/headers';
import TopBar from '@/components/TopBar';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { clientIp } from '@/lib/route';
import { requirePage } from '@/lib/session';
import { formatDayShort, nowDate, workDate } from '@/lib/time';
import { ai } from '@/modules/ai';
import { projectFiles } from '@/modules/projectFiles';
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

/** Today's Gemini requests for Settings → AI (CONTRACT 20), or null when they can't be read. */
async function aiUsage() {
  try {
    return await ai.usageToday();
  } catch (error) {
    logger.warn({ err: error }, "settings: could not read today's AI requests");
    return null;
  }
}

/** Space used by files for Settings → Files (CONTRACT 27), or null when it can't be read. */
async function filesUsage() {
  try {
    return await projectFiles.spaceUsage();
  } catch (error) {
    logger.warn({ err: error }, 'settings: could not read the space used by files');
    return null;
  }
}

const DISK_FULL_SHOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The plain values FilesSection shows: the numbers, the storage problem (null when ready) and the
 * company day of a disk-full refusal within the last 7 days ("Sat, 21 Nov").
 */
function filesSpace(usage, timezone) {
  if (!usage) return null;
  const fullAt = usage.diskFullAt ? new Date(usage.diskFullAt) : null;
  const recent = fullAt && nowDate().getTime() - fullAt.getTime() <= DISK_FULL_SHOWN_MS;
  return {
    usedBytes: Number(usage.usedBytes) || 0,
    heldBytes: Number(usage.heldBytes) || 0,
    deletedBytes: Number(usage.deletedBytes) || 0,
    fileCount: Number(usage.fileCount) || 0,
    projectCount: Number(usage.projectCount) || 0,
    updateNeeded: Boolean(usage.updateNeeded),
    problem: usage.storage?.ready ? null : (usage.storage?.problem ?? 'not_set'),
    diskFullOn: recent ? formatDayShort(workDate(timezone, fullAt)) : null,
  };
}

export default async function SettingsPage() {
  await requirePage('settings.manage');
  const [values, networks, connection, requestHeaders, usage, space] = await Promise.all([
    settings.getAll(),
    settings.listOfficeNetworks(),
    slackConnection(),
    headers(),
    aiUsage(),
    filesUsage(),
  ]);
  // Whether the server has a Gemini key: the page only ever gets this boolean, never the key.
  const aiConfigured = Boolean(env.GEMINI_API_KEY);

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
          ai={{ configured: aiConfigured, usage }}
          files={filesSpace(space, values.timezone)}
        />
      </div>
    </SettingsProvider>
  );
}
