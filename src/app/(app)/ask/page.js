// Ask Daybook (CONTRACT 20; no artboard, built from the canvas components): Admin, PM and HR ask
// questions about hours, tasks and attendance, answered by Gemini from the data they may see.
// The answers of this visit stay in the page only. While AI or Ask Daybook is off the page says
// so (and sends an Admin to Settings).
import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import TopBar from '@/components/TopBar';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/session';
import { aiAsk } from '@/modules/aiAsk';
import AskChat from './AskChat';
import { askCopyFor } from './askCopy';
import styles from './page.module.css';

export const metadata = { title: 'Ask Daybook' };

function AiOff({ canManageSettings }) {
  return (
    <Card>
      <EmptyState
        icon={<Sparkles size={20} strokeWidth={1.8} />}
        title="AI is turned off"
        body={
          canManageSettings
            ? 'Turn on AI and Ask Daybook in Settings to ask questions about hours, tasks and attendance.'
            : 'Ask an Admin to turn on AI in Settings. Then you can ask questions about hours, tasks and attendance here.'
        }
        action={
          canManageSettings ? (
            <Button variant="secondary" href="/settings#ai">
              Open settings
            </Button>
          ) : null
        }
      />
    </Card>
  );
}

export default async function AskPage() {
  // Two permissions open this page (team.view or attendance.view_all), so it checks them itself.
  const user = await requirePage(null);
  if (!aiAsk.canAsk(user)) redirect('/no-access');
  const available = await aiAsk.isAvailableFor(user);
  const { subtitle, ...copy } = askCopyFor(aiAsk.viewerKind(user));

  return (
    <div className={styles.page}>
      <TopBar title="Ask Daybook" subtitle={subtitle} bell avatar />
      {available ? (
        <AskChat {...copy} />
      ) : (
        <AiOff canManageSettings={can(user, 'settings.manage')} />
      )}
    </div>
  );
}
