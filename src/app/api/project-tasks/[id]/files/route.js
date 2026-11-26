// POST /api/project-tasks/:id/files { uploadKeys?: [0 to 20], linkFileIds?: [0 to 20],
// shareConfirmed?, shareWith? } (one list at least, together up to 20): adds the PM's held uploads
// and links project files to an existing task (the task window's "Add files", "From project files"
// and a drop on a card, CONTRACT 27, 28), tells the task's person (or everyone on the project for
// a task for anyone) in one `files_added` and answers 201 { files, told, toldName }. The project's
// PM or Admin; RATE_LIMITED past 60 a minute for one person.
import { AppError } from '@/lib/errors';
import { checkRateLimit, withRoute } from '@/lib/route';
import { projectTasks } from '@/modules/projectTasks';
import { projectTaskFilesSchema, routeId } from '@/modules/projectTasks/schemas';

// Per person, not per IP: behind the office network everyone shares one address.
const PER_PERSON = { key: 'project-task-files', limit: 60, windowMs: 60_000 };
const ROUTE = '/api/project-tasks/[id]/files';

export const POST = withRoute(
  { permission: 'project.manage', body: projectTaskFilesSchema, status: 201 },
  async ({ user, params, body, ip }) => {
    checkRateLimit(PER_PERSON, ROUTE, `user:${user.id}`);
    const id = routeId(params);
    if (!id) throw new AppError('NOT_FOUND', { message: "We couldn't find that priority task." });
    const { uploadKeys, linkFileIds, shareConfirmed, shareWith } = body;
    return projectTasks.attachFiles({
      user,
      id,
      uploadKeys,
      linkFileIds,
      shareConfirmed,
      shareWith,
      ip,
    });
  },
);
