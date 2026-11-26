// /my-tasks (CONTRACT 28, My tasks: sidebar, page and home cards): the open tasks PMs and Admins
// took or were given, on their Active and On hold projects, grouped by when they are due (or by
// project), with a project select and a search. Refreshes every minute while visible, so a task
// taken on another page shows without a reload (without motion).
import TopBar from '@/components/TopBar';
import { requirePage } from '@/lib/session';
import AutoRefresh from '../today/AutoRefresh';
import { loadMyTasks } from './myTasksData';
// With its extension: myTasksView.js (pure) sits beside it, and on a case-insensitive disk a
// resolver that tries .js first would take that file.
import MyTasksView from './MyTasksView.jsx';

export const metadata = { title: 'My tasks' };

export default async function MyTasksPage() {
  const user = await requirePage('project.manage');
  const mine = await loadMyTasks({ user });
  return (
    <>
      <AutoRefresh />
      <TopBar title="My tasks" subtitle="Tasks you took or were given, on all your projects" />
      <MyTasksView mine={mine} />
    </>
  );
}
