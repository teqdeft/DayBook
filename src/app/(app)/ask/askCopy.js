// Words for the Ask Daybook page per viewer kind (aiAsk.viewerKind): example questions that the
// viewer's tools can answer, one line on what Ask Daybook can see for them, and the subtitle,
// empty-state title and question-box placeholder (CONTRACT 20).

const EXAMPLES = {
  admin: [
    'How many hours did each project get this week?',
    'Who logged the most hours last month?',
    'Which tasks are blocked right now?',
    'Who was late most often this month?',
    'Which P1 tasks are still open?',
  ],
  pm: [
    'How many hours went into my projects this week?',
    'What did the team finish yesterday?',
    'Which tasks are blocked on my projects?',
    'Which P1 tasks are still open?',
    'Who logged hours on my projects last week?',
  ],
  hr: [
    'Who was late most often this month?',
    'How many work from home days were there last week?',
    'Who has missing check-outs this month?',
    'What was the average check-in time this week?',
    'Who had working days without a check-in last week?',
  ],
};

// What the page asks for: HR's tools only answer about attendance (CONTRACT 20).
const PROMPTS = {
  admin: {
    subtitle: "Questions about hours, tasks and attendance, answered from Daybook's data",
    emptyTitle: 'Ask about hours, tasks and attendance',
    placeholder: 'Ask about hours, tasks or attendance',
  },
  pm: {
    subtitle: "Questions about your projects and their people, answered from Daybook's data",
    emptyTitle: 'Ask about your projects',
    placeholder: 'Ask about hours, tasks or attendance on your projects',
  },
  hr: {
    subtitle: "Questions about attendance, answered from Daybook's data",
    emptyTitle: 'Ask about attendance',
    placeholder: 'Ask about check-ins, late days, work from home and breaks',
  },
};

const SEES = {
  admin:
    "Everything: every project's hours, report tasks and priority tasks, and everyone's attendance.",
  pm: 'The projects you manage and the people on them: hours, report tasks, priority tasks and their attendance.',
  hr: "Attendance: check-ins, late days, work from home, breaks and check-outs. Admins' attendance isn't included.",
};

/**
 * @param {'admin' | 'pm' | 'hr'} kind
 * @returns {{ examples: string[], sees: string, subtitle: string, emptyTitle: string,
 *   placeholder: string }}
 */
export function askCopyFor(kind) {
  return {
    examples: EXAMPLES[kind] ?? EXAMPLES.hr,
    sees: SEES[kind] ?? SEES.hr,
    ...(PROMPTS[kind] ?? PROMPTS.hr),
  };
}
