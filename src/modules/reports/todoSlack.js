// "Post to Slack" on today's to-do (CONTRACT 24): the person's choice. The to-do goes to the
// to-do channel picked in Settings (never the report channel), as the person; the first post
// sends a message and later ones update it. The slack module's outbox delivers it and stores the
// message on the report (saveTodoSlackMessage).
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { audit } from '@/modules/audit';
import { slack } from '@/modules/slack';
import { formatTodo } from '@/modules/slack/format';
import * as repo from './repo';
import { getTodo } from './todoRead';
import { planHash, planOf } from './todoView';
import { findTodayReport } from './todoWrite';
import { isEditable, loadEntriesFor } from './view';

const NO_SUCH_COLUMN = 1054;

function nothingToPost() {
  return new AppError('CONFLICT', { message: 'Add a task first.' });
}

/**
 * The to-do message columns of the locked report. Before migration 017 there is nowhere to keep
 * the message, so posting is refused rather than sending posts that can never be updated.
 * @throws TODO_UNAVAILABLE (503)
 */
async function postedMessage(reportId, trx) {
  try {
    return await repo.findTodoPost(reportId, trx);
  } catch (error) {
    if (error?.errno !== NO_SUCH_COLUMN) throw error;
    throw new AppError('TODO_UNAVAILABLE', {
      status: 503,
      message: 'This needs the latest database update. Ask an Admin.',
    });
  }
}

/**
 * Queues today's to-do for Slack: in one transaction that locks the report row, builds the text
 * (formatTodo: every project with a line, Done and Blocked suffixes) and the plan's hash, and
 * queues it as a new post, or as an update when the report already has a to-do message. Audit
 * `report.todo_post` with the report id.
 * @param {{ user: object, ip?: string | null }} input
 * @returns {Promise<{ queued: 'post' | 'update', todo: object }>} todo: the new to-do (getTodo,
 *   post.state 'sending')
 * @throws CONFLICT ("Add a task first." with no line; "Slack posting is off." without Slack, a
 *   bot token or a to-do channel), REPORT_LOCKED (the report has locked), TODO_UNAVAILABLE (503,
 *   migration 017 hasn't run)
 */
export async function queueTodoPost({ user, ip = null }) {
  const { report } = await findTodayReport(user);
  if (!report) throw nothingToPost();
  const queued = await db.transaction(async (trx) => {
    const locked = await repo.findByIdForUpdate(report.id, trx);
    if (!isEditable(locked)) throw new AppError('REPORT_LOCKED');
    const posted = await postedMessage(locked.id, trx);
    const entries = (await loadEntriesFor([locked.id], trx)).get(locked.id) ?? [];
    const plan = planOf(entries);
    if (plan.length === 0) throw nothingToPost();
    const hash = planHash(plan);
    const update = Boolean(posted?.todoSlackTs);
    await slack.queueTodoPost(
      {
        reportId: locked.id,
        userId: user.id,
        text: formatTodo({ userName: user.name, workDate: locked.workDate, entries: plan }),
        hash,
        update,
        userName: user.name,
        avatarUrl: user.avatarUrl ?? null,
      },
      trx,
    );
    const kind = update ? 'update' : 'post';
    await audit.log(
      {
        actorId: user.id,
        action: 'report.todo_post',
        entityType: 'daily_report',
        entityId: locked.id,
        after: { queued: kind, hash },
        ip,
      },
      trx,
    );
    return kind;
  });
  return { queued, todo: await getTodo({ user }) };
}
