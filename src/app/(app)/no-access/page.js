// Shown when someone opens a screen their role can't use (requirePage redirects here).
import { ShieldOff } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import TopBar from '@/components/TopBar';
import { homePathFor } from '@/config/navigation';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'No access' };

export default async function NoAccessPage() {
  const user = await requireUser();
  return (
    <>
      <TopBar title="No access" subtitle={`Signed in as ${user.name}, ${user.roleLabel}`} />
      <Card padding="none">
        <EmptyState
          icon={<ShieldOff size={20} strokeWidth={1.8} />}
          title="You don't have access to this page"
          body="Your role can't open this screen. If you think it should, ask an Admin."
          action={<Button href={homePathFor(user)}>Go to your start page</Button>}
        />
      </Card>
    </>
  );
}
