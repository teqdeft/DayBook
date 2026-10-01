// The signed-in app: sidebar + main area. Every page inside calls requirePage() for its own
// permission; this layout only makes sure someone is signed in.
import AppFrame from '@/components/AppFrame';
import { requireUser } from '@/lib/session';

export default async function AppLayout({ children }) {
  const user = await requireUser();
  return <AppFrame user={user}>{children}</AppFrame>;
}
