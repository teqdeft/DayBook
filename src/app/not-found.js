// 404: any unknown URL and any notFound() call. Signed-in people see it inside the app shell
// (sidebar and all); everyone else gets a small card with a way to sign in.
import { FileQuestion } from 'lucide-react';
import AppFrame from '@/components/AppFrame';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import Logo from '@/components/Logo';
import TopBar from '@/components/TopBar';
import { homePathFor } from '@/config/navigation';
import { getSessionUser } from '@/lib/session';
import styles from './not-found.module.css';

export const metadata = { title: 'Page not found' };

export default async function NotFound() {
  const user = await getSessionUser();
  const icon = <FileQuestion size={20} strokeWidth={1.8} />;

  if (user) {
    return (
      <AppFrame user={user}>
        <TopBar title="Page not found" subtitle="The link may be old, or the page has moved." />
        <Card padding="none">
          <EmptyState
            icon={icon}
            title="We couldn't find that page"
            body="Check the address, or go back to your start page."
            action={<Button href={homePathFor(user)}>Go to your start page</Button>}
          />
        </Card>
      </AppFrame>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Logo tone="dark" />
        <div className={styles.text}>
          <h1 className={styles.title}>Page not found</h1>
          <p className={styles.body}>The link may be old, or the page has moved.</p>
        </div>
        <Button href="/login" fullWidth>
          Go to sign in
        </Button>
      </div>
    </main>
  );
}
