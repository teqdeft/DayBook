// In-app notifications and Slack direct messages for projects and project requests
// (build guide section 11). In-app rows are always created; Slack follows its settings.
import { env } from '@/lib/env';
import { notifications } from '@/modules/notifications';
import { slack } from '@/modules/slack';
import { escapeSlackText } from '@/modules/slack/format';

const link = (path, label) => `<${env.appOrigin}${path}|${label}>`;

/** Every member hears about an urgent project: bell + Slack DM (slack_urgent_notify). */
export async function sendUrgent({ project, note, actorName, members }, trx) {
  const ids = members.map((member) => member.id);
  await notifications.notify(
    {
      userIds: ids,
      type: 'project.urgent',
      title: `${project.name} is urgent`,
      body: note,
      link: '/today',
    },
    trx,
  );
  const text =
    `${escapeSlackText(actorName)} marked *${escapeSlackText(project.name)}* as urgent: ` +
    `${escapeSlackText(note)}\n${link('/today', 'Open Today in Daybook')}`;
  for (const member of members) {
    await slack.queueDm(
      {
        slackUserId: member.slackUserId,
        text,
        settingKey: 'slackUrgentNotify',
        relatedType: 'project',
        relatedId: project.id,
      },
      trx,
    );
  }
}

/** The new PM of a project someone else created or handed over. */
export async function sendNewPm({ project, pmId, body }, trx) {
  await notifications.notify(
    {
      userIds: [pmId],
      type: 'project.created',
      title: `You are the PM of ${project.name}`,
      body,
      link: '/projects',
    },
    trx,
  );
}

/**
 * People newly added to a project's team hear about it in the bell (and on the desktop). The
 * person who added them, and anyone in `skipIds`, is left out.
 * @returns {Promise<number>} how many were notified
 */
export async function sendMemberAdded({ project, userIds, actor, skipIds = [] }, trx) {
  const skip = new Set([actor.id, ...skipIds].map(Number));
  const ids = userIds.filter((id) => !skip.has(Number(id)));
  if (ids.length === 0) return 0;
  return notifications.notify(
    {
      userIds: ids,
      type: 'project.member_added',
      title: `You were added to ${project.name}`,
      body: `${actor.name} added you to the project team.`,
      link: '/projects',
    },
    trx,
  );
}

/** A new project request: the bell and a Slack DM (slack_requests_notify) for the approvers. */
export async function sendRequestCreated({ request, requester, approvers }, trx) {
  await notifications.notify(
    {
      userIds: approvers.map((person) => person.id),
      type: 'project_request.created',
      title: `${requester.name} asked for a project: ${request.name}`,
      body: request.note,
      link: '/requests',
    },
    trx,
  );
  const text =
    `${escapeSlackText(requester.name)} asked for a new project: *${escapeSlackText(request.name)}*` +
    `\nReason: ${escapeSlackText(request.note)}\n${link('/requests', 'Review it in Daybook')}`;
  for (const approver of approvers) {
    await slack.queueDm(
      {
        slackUserId: approver.slackUserId,
        text,
        settingKey: 'slackRequestsNotify',
        relatedType: 'project_request',
        relatedId: request.id,
      },
      trx,
    );
  }
}

/** The requester hears the decision: bell + Slack DM (slack_requests_notify). */
export async function sendRequestDecided({ request, requester, approved, project, reason }, trx) {
  const title = approved
    ? 'Your project request was approved'
    : 'Your project request was declined';
  const body = approved
    ? `${project.name} is ready. You can log hours to it.`
    : `${request.name}: ${reason}`;
  await notifications.notify(
    {
      userIds: [requester.id],
      type: `project_request.${approved ? 'approved' : 'declined'}`,
      title,
      body,
      link: '/projects',
    },
    trx,
  );
  const text = approved
    ? `Your request for *${escapeSlackText(request.name)}* was approved. ` +
      `*${escapeSlackText(project.name)}* is ready and you can log hours to it.\n` +
      link('/report', 'Open your report')
    : `Your request for *${escapeSlackText(request.name)}* was declined: ` +
      `${escapeSlackText(reason)}\n${link('/projects', 'Open Projects in Daybook')}`;
  await slack.queueDm(
    {
      slackUserId: requester.slackUserId,
      text,
      settingKey: 'slackRequestsNotify',
      relatedType: 'project_request',
      relatedId: request.id,
    },
    trx,
  );
}
