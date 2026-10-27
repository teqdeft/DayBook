// The person's own settings that change the daily report (CONTRACT 21, My settings): which submit
// buttons the top bar shows, the status of task lines added by hand, the Slack preview and the
// three polish switches. Pure: the page picks them on the server (data.preferences), the editor
// reads them in the browser, and the unit tests call them directly.

/** The report's keys and their defaults (the same as the preferences module's defaults). */
export const REPORT_PREFERENCE_DEFAULTS = Object.freeze({
  submitButtons: 'both',
  newTaskStatus: 'in_progress',
  slackPreview: true,
  polishButton: true,
  polishLines: true,
  polishAfterTimers: true,
});

/** The keys with a list of values; the others are on or off. */
const CHOICES = {
  submitButtons: ['both', 'checkout', 'submit'],
  newTaskStatus: ['in_progress', 'done'],
};

/**
 * The report's settings out of every preference (preferences.getFor): a key that is missing or
 * holds a value the report doesn't know keeps its default.
 * @param {object | null | undefined} all
 * @returns {{ submitButtons: 'both' | 'checkout' | 'submit', newTaskStatus: 'in_progress' | 'done',
 *   slackPreview: boolean, polishButton: boolean, polishLines: boolean,
 *   polishAfterTimers: boolean }}
 */
export function reportPreferences(all) {
  const picked = {};
  for (const [key, fallback] of Object.entries(REPORT_PREFERENCE_DEFAULTS)) {
    const value = all?.[key];
    const valid = CHOICES[key] ? CHOICES[key].includes(value) : typeof value === 'boolean';
    picked[key] = valid ? value : fallback;
  }
  return picked;
}

/** The page's data.preferences, or the defaults when it has none. */
export function preferencesOf(data) {
  return data?.preferences ?? REPORT_PREFERENCE_DEFAULTS;
}

/**
 * Which submit buttons an editable report's top bar has (CONTRACT 21, "Submit buttons").
 * "Update report" never hides. 'submit' leaves out "Submit and check out"; 'checkout' hides
 * "Submit report" only while "Submit and check out" shows (today's draft, still checked in), so a
 * report can always be sent.
 * @param {{ submitButtons: string, canCheckOut: boolean, status: string }} input canCheckOut is
 *   the page's data.canCheckOut; status the report's current status
 * @returns {{ checkOut: boolean, submit: boolean, checkOutPrimary: boolean }} checkOut: render
 *   SubmitAndCheckOut (it shows its button on a draft); submit: render Submit report / Update
 *   report; checkOutPrimary: Submit and check out is the only way to send the report, so it is
 *   the top bar's primary (blue) button
 */
export function submitButtonsShown({ submitButtons, canCheckOut, status }) {
  const checkOut = Boolean(canCheckOut) && submitButtons !== 'submit';
  const checkOutShows = checkOut && status === 'draft';
  const submit = !(submitButtons === 'checkout' && checkOutShows);
  return { checkOut, submit, checkOutPrimary: !submit };
}

/**
 * Which polish features the report offers (CONTRACT 20 and 21): all need the company's AI
 * (data.aiPolish) and an editable report; then each has the person's own switch.
 * @param {{ aiPolish: boolean, readOnly: boolean, preferences: object }} input
 * @returns {{ available: boolean, button: boolean, lines: boolean, afterTimers: boolean }}
 *   available: polishing can happen at all; button: the top bar's Polish with AI; lines: the
 *   sparkle on each task line; afterTimers: the offer after Fill report from timers
 */
export function polishGates({ aiPolish, readOnly, preferences }) {
  const available = Boolean(aiPolish) && !readOnly;
  const prefs = preferences ?? REPORT_PREFERENCE_DEFAULTS;
  return {
    available,
    button: available && prefs.polishButton !== false,
    lines: available && prefs.polishLines !== false,
    afterTimers: available && prefs.polishAfterTimers !== false,
  };
}
