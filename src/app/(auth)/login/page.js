// Sign in: a centered card on the paper background with "Sign in with Slack". Errors from the
// Slack callback arrive as ?error=CODE. In development a second card signs in as a demo person.
import { redirect } from 'next/navigation';
import { CircleAlert } from 'lucide-react';
import Button from '@/components/Button';
import Logo from '@/components/Logo';
import { env } from '@/lib/env';
import { ERROR_CODES } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { safeNextPath } from '@/lib/safeRedirect';
import { getSessionUser } from '@/lib/session';
import { settings } from '@/modules/settings';
import { users } from '@/modules/users';
import DevSignIn from './DevSignIn';
import SlackMark from './SlackMark';
import styles from './page.module.css';

export const metadata = { title: 'Sign in' };

const SIGN_IN_ERRORS = [
  'NOT_IN_DAYBOOK',
  'ACCOUNT_DEACTIVATED',
  'WRONG_WORKSPACE',
  'SLACK_NOT_CONFIGURED',
  'SIGNIN_STATE_MISMATCH',
  'SLACK_ERROR',
  'RATE_LIMITED',
  'INTERNAL',
];

function errorMessage(code, companyName) {
  if (!code) return null;
  const known = SIGN_IN_ERRORS.includes(code) ? code : 'INTERNAL';
  if (known === 'WRONG_WORKSPACE') {
    return companyName
      ? `Use the ${companyName} Slack workspace.`
      : "Use your company's Slack workspace.";
  }
  if (known === 'SLACK_NOT_CONFIGURED') {
    return 'Sign in with Slack is not set up yet. Ask your admin to finish the Slack setup.';
  }
  return ERROR_CODES[known].message;
}

async function companyNameOrEmpty() {
  try {
    const all = await settings.getAll();
    return all?.companyName ?? '';
  } catch (error) {
    logger.warn({ err: error }, 'login: could not load settings');
    return '';
  }
}

async function devPeople() {
  if (!env.devLoginEnabled) return null;
  try {
    const people = await users.listActive();
    return (people ?? []).map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
      initials: person.initials,
      role: person.role,
      roleLabel: person.roleLabel,
      designation: person.designation,
    }));
  } catch (error) {
    logger.warn({ err: error }, 'login: could not list people for development sign-in');
    return [];
  }
}

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const next = safeNextPath(params?.next);
  if (await getSessionUser()) redirect(next ?? '/');

  const [companyName, people] = await Promise.all([companyNameOrEmpty(), devPeople()]);
  const code = typeof params?.error === 'string' ? params.error : null;
  const message = errorMessage(code, companyName);

  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <section className={styles.card} aria-labelledby="login-title">
          <Logo size={36} tone="dark" className={styles.logo} />
          <div className={styles.heading}>
            <h1 id="login-title" className={styles.title}>
              Sign in to Daybook
            </h1>
            <p className={styles.lead}>Check in, log your day and send your daily report.</p>
          </div>
          {message ? (
            <div className={styles.error} role="alert">
              <CircleAlert
                size={18}
                strokeWidth={1.8}
                aria-hidden="true"
                className={styles.errorIcon}
              />
              <p>{message}</p>
            </div>
          ) : null}
          {/* A plain GET form: the browser leaves the app for Slack (no client-side routing). */}
          <form action="/api/auth/slack/start" method="get" className={styles.slackForm}>
            <Button type="submit" fullWidth icon={<SlackMark />}>
              Sign in with Slack
            </Button>
          </form>
          <p className={styles.help}>
            {companyName
              ? `Use your ${companyName} Slack account. Only people HR has added can sign in.`
              : 'Use your work Slack account. Only people HR has added can sign in.'}
          </p>
        </section>

        {people ? <DevSignIn people={people} next={next} /> : null}
      </div>
    </main>
  );
}
