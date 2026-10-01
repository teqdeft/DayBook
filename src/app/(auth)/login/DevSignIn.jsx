'use client';
// Development only (the page renders this only when env.devLoginEnabled): sign in as any active
// person without Slack, through POST /api/auth/dev-login.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Tag from '@/components/Tag';
import { api } from '@/lib/apiClient';
import styles from './DevSignIn.module.css';

/**
 * @param {{
 *   people: { id: number, name: string, email: string, initials?: string, role: string,
 *     roleLabel?: string, designation?: string }[],
 *   next?: string | null,
 * }} props
 */
export default function DevSignIn({ people, next }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  async function signIn(address) {
    const value = address.trim();
    if (!value) {
      setError('Enter the email of someone in Daybook.');
      return;
    }
    setBusy(value);
    setError('');
    try {
      await api.post('/api/auth/dev-login', { email: value });
      router.replace(next || '/');
      router.refresh();
    } catch (failure) {
      setBusy(null);
      setError(failure.fields?.email ?? failure.message);
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    signIn(email);
  }

  return (
    <section className={styles.card} aria-labelledby="dev-signin-title">
      <div className={styles.head}>
        <h2 id="dev-signin-title" className={styles.title}>
          Development sign-in
        </h2>
        <Tag tone="marigold">Dev only</Tag>
      </div>
      <p className={styles.note}>
        Sign in as a demo person without Slack. This never shows in production.
      </p>

      {people.length > 0 ? (
        <ul className={styles.list} aria-label="People">
          {people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                className={styles.person}
                onClick={() => signIn(person.email)}
                disabled={busy !== null}
                aria-busy={busy === person.email || undefined}
              >
                <Avatar user={person} size={32} />
                <span className={styles.personText}>
                  <span className={styles.name}>{person.name}</span>
                  <span className={styles.sub}>{person.designation || person.email}</span>
                </span>
                <span className={styles.role}>
                  {busy === person.email ? 'Signing in…' : (person.roleLabel ?? person.role)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field
          label={people.length > 0 ? 'Or sign in by email' : 'Email'}
          htmlFor="dev-email"
          error={error || undefined}
        >
          <Input
            id="dev-email"
            type="email"
            autoComplete="off"
            placeholder="name@company.com"
            value={email}
            error={Boolean(error)}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          fullWidth
          loading={busy !== null && busy === email.trim()}
        >
          Sign in
        </Button>
      </form>
    </section>
  );
}
