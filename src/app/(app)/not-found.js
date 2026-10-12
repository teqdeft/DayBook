// 404 inside the signed-in app: a page under (app) that calls notFound() (an unknown project, or
// an Admin's Employee page for anyone but an Admin). The (app) layout already draws the sidebar,
// so this renders only the top bar and the card; src/app/not-found.js covers unknown URLs.
import { FileQuestion } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import TopBar from '@/components/TopBar';
import { homePathFor } from '@/config/navigation';
import { getSessionUser } from '@/lib/session';

export const metadata = { title: 'Page not found' };

export default async function AppNotFound() {
  const user = await getSessionUser();
  return (
    <>
      <TopBar title="Page not found" subtitle="The link may be old, or the page has moved." />
      <Card padding="none">
        <EmptyState
          icon={<FileQuestion size={20} strokeWidth={1.8} />}
          title="We couldn't find that page"
          body="Check the address, or go back to your start page."
          action={<Button href={user ? homePathFor(user) : '/'}>Go to your start page</Button>}
        />
      </Card>
    </>
  );
}
