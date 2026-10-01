import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { homePathFor } from '@/config/navigation';

// "/" sends Admin to /overview and everyone else to /today.
export default async function Home() {
  const user = await requireUser();
  redirect(homePathFor(user));
}
