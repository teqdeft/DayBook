// /requests (artboard 08): report edit requests and project requests waiting for this PM or
// Admin, with "Recently handled" and "How edits work". loading.js shows the skeleton.
import { requirePage } from '@/lib/session';
import RequestsView from './RequestsView';

export const metadata = { title: 'Requests' };

export default async function RequestsPage({ searchParams }) {
  const user = await requirePage('project_request.handle');
  const params = await searchParams;
  return <RequestsView user={user} params={params} />;
}
