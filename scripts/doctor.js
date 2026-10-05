// `npm run doctor`: a read-only check for a live server. It prints whether the worker cron is
// running, whether Slack works (token, report channel, queue) and whether desktop notifications
// can be delivered (keys, the Settings switch, who turned them on, the latest notifications).
// It never prints tokens, private keys or push endpoints, so its output is safe to share.
//
// `npm run doctor -- --notify=person@company.com` also adds a test bell notification for that
// person; the worker pops it up on their computer within a minute.
import webpush from 'web-push';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { minutesBetween, now, toLocal } from '@/lib/time';
import { notifications } from '@/modules/notifications';
import { settings } from '@/modules/settings';
import { slack } from '@/modules/slack';
import * as slackClient from '@/modules/slack/client';

const OK = '  ✓';
const BAD = '  ✗';
const NOTE = '  !';

function ago(at) {
  if (!at) return 'never';
  const minutes = minutesBetween(at, now());
  if (minutes < 1) return 'just now';
  if (minutes < 120) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

function notifyArg() {
  const arg = process.argv.find((value) => value.startsWith('--notify='));
  return arg ? arg.slice('--notify='.length).trim().toLowerCase() : '';
}

async function checkWorker() {
  console.log('\nWorker (the cron job)');
  // health-log writes a job_runs row every 5 minutes while the worker runs.
  const last = await db('job_runs')
    .where('runKey', 'like', 'health_log:%')
    .orderBy('startedAt', 'desc')
    .first('startedAt');
  const minutes = last ? minutesBetween(last.startedAt, now()) : null;
  if (minutes !== null && minutes <= 10) {
    console.log(`${OK} Running: last health check ${ago(last.startedAt)}`);
  } else {
    console.log(
      `${BAD} Not running (last run: ${last ? ago(last.startedAt) : 'never'}). Add the cron job ` +
        'in cPanel → Cron Jobs (README: Deploying on cPanel, step 8). Nothing is sent without it.',
    );
  }
}

async function checkSlack(current) {
  console.log('\nSlack');
  if (!slack.isConfigured()) {
    console.log(`${BAD} SLACK_BOT_TOKEN is not set in .env.local`);
    return;
  }
  if (!current.slackEnabled) console.log(`${BAD} Slack is switched off in Settings → Slack`);
  let botUserId = null;
  try {
    const result = await slackClient.authTest();
    botUserId = result.botUserId;
    console.log(`${OK} Bot token works (workspace: ${result.teamName ?? 'unknown'})`);
  } catch (error) {
    console.log(`${BAD} Bot token refused by Slack: ${slackClient.slackErrorCode(error)}`);
  }
  const channelId = current.slackReportChannelId;
  if (!channelId) {
    console.log(`${BAD} No report channel picked (Settings → Slack → Post reports to)`);
  } else if (botUserId) {
    try {
      const channels = await slackClient.listMemberChannels();
      const inChannel = channels.some((channel) => channel.id === channelId);
      const name = current.slackReportChannelName ?? channelId;
      console.log(
        inChannel
          ? `${OK} Reports go to #${name} and the bot is in it`
          : `${BAD} Reports go to #${name}, but the bot isn't in it. Add the app to the channel.`,
      );
    } catch (error) {
      console.log(`${NOTE} Couldn't list channels: ${slackClient.slackErrorCode(error)}`);
    }
  }
  if (!current.slackPostReports) console.log(`${NOTE} Posting reports is off in Settings → Slack`);

  const health = await slack.outboxHealth();
  if (health.pending === 0) console.log(`${OK} Queue: nothing waiting`);
  else {
    console.log(
      `${NOTE} Queue: ${health.pending} waiting, the oldest since ${ago(health.oldestPendingAt)}`,
    );
  }
  const lastError = await db('slack_outbox')
    .whereNotNull('lastError')
    .orderBy('updatedAt', 'desc')
    .first('lastError', 'status', 'updatedAt');
  if (lastError && minutesBetween(lastError.updatedAt, now()) < 24 * 60) {
    console.log(
      `${NOTE} Last Slack error (${ago(lastError.updatedAt)}, ${lastError.status}): ${lastError.lastError}`,
    );
  }
}

async function checkPush(current, tz) {
  console.log('\nDesktop notifications');
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.log(`${BAD} VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must both be set in .env.local`);
  } else {
    try {
      webpush.setVapidDetails(env.VAPID_SUBJECT, publicKey, privateKey);
      console.log(
        `${OK} Push keys are set and valid (public key starts ${publicKey.slice(0, 8)}…)`,
      );
    } catch (error) {
      console.log(`${BAD} Push keys or VAPID_SUBJECT are invalid: ${error.message}`);
    }
  }
  console.log(
    current.pushEnabled === false
      ? `${BAD} Switched off in Settings → Notifications`
      : `${OK} Switched on in Settings → Notifications`,
  );

  const browsers = await db('push_subscriptions as s')
    .join('users as u', 'u.id', 's.userId')
    .groupBy('u.id', 'u.name')
    .orderBy('u.name')
    .select('u.name')
    .count({ browsers: '*' })
    .max({ lastSuccessAt: 's.lastSuccessAt', updatedAt: 's.updatedAt' })
    .sum({ failures: 's.failureCount' });
  if (browsers.length === 0) {
    console.log(
      `${BAD} Nobody has turned them on yet: each person opens the bell → "Show on this computer" → Allow`,
    );
  } else {
    console.log(
      `${OK} Turned on by ${browsers.length} ${browsers.length === 1 ? 'person' : 'people'}:`,
    );
    for (const row of browsers) {
      const failures = Number(row.failures ?? 0);
      console.log(
        `      ${row.name}: ${row.browsers} browser(s), turned on ${ago(row.updatedAt)}, ` +
          `last delivered ${ago(row.lastSuccessAt)}${failures > 0 ? `, ${failures} failed sends` : ''}`,
      );
    }
  }

  const latest = await db('notifications as n')
    .join('users as u', 'u.id', 'n.userId')
    .orderBy('n.id', 'desc')
    .limit(8)
    .select('n.userId', 'u.name', 'n.type', 'n.createdAt', 'n.pushedAt');
  if (latest.length === 0) return;
  const subscribed = new Set(
    (
      await db('push_subscriptions')
        .whereIn('userId', [...new Set(latest.map((row) => row.userId))])
        .distinct('userId')
    ).map((row) => row.userId),
  );
  console.log('\nLatest bell notifications');
  for (const row of latest) {
    let state;
    if (!row.pushedAt) state = 'waiting for the worker';
    else if (!subscribed.has(row.userId)) state = 'handled (no browser turned on, so no pop-up)';
    else state = 'handled by the worker';
    console.log(
      `  ${toLocal(row.createdAt, tz).format('DD MMM HH:mm')}  ${row.name}  ${row.type}  → ${state}`,
    );
  }
}

async function sendTest(email) {
  const user = await db('users').whereRaw('LOWER(email) = ?', [email]).first('id', 'name');
  if (!user) {
    console.log(`\n${BAD} No Daybook user has the email ${email}`);
    return;
  }
  await notifications.notify({
    userIds: [user.id],
    type: 'system.test',
    title: 'Test notification from Daybook',
    body: 'If you can see this on your computer, desktop notifications work.',
    link: '/today',
  });
  console.log(
    `\n${OK} Test notification added for ${user.name}. It shows in their bell now and pops up on ` +
      'their computer within a minute (if they turned it on and the worker is running).',
  );
}

async function main() {
  const current = await settings.getAll();
  const tz = current.timezone || env.DEFAULT_TIMEZONE;
  console.log(
    `Daybook doctor: ${toLocal(now(), tz).format('DD MMM YYYY HH:mm')} (${tz}), ` +
      `Node ${process.version}, ${env.NODE_ENV}, ${env.APP_URL}`,
  );
  await checkWorker();
  await checkSlack(current);
  await checkPush(current, tz);
  const email = notifyArg();
  if (email) await sendTest(email);
  console.log('');
}

main()
  .catch((error) => {
    console.error('Doctor failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
