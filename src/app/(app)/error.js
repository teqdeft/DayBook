'use client';
// A page inside the app failed to load. The sidebar stays; the person can try again.
import { useEffect } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import styles from './error.module.css';

export default function AppError({ error, retry, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const tryAgain = retry ?? reset;

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.subtitle}>This page didn&apos;t load.</p>
      </header>
      <Card padding="none">
        <EmptyState
          icon={<TriangleAlert size={20} strokeWidth={1.8} />}
          title="We couldn't load this page"
          body="Try again in a moment. If it keeps happening, tell your admin and share the reference below."
          action={
            <div className={styles.actions}>
              <Button icon={<RotateCw size={18} strokeWidth={1.8} />} onClick={() => tryAgain?.()}>
                Try again
              </Button>
              <Button variant="secondary" href="/">
                Go to your start page
              </Button>
            </div>
          }
        />
        {error?.digest ? <p className={styles.reference}>Reference: {error.digest}</p> : null}
      </Card>
    </>
  );
}
