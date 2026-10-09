// AppError and the error codes the API returns. Each code has a default HTTP status and message.

export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 400, message: 'Some fields need your attention.' },
  BAD_REQUEST: { status: 400, message: 'That request is not valid.' },
  UNAUTHENTICATED: { status: 401, message: 'Please sign in to continue.' },
  FORBIDDEN: { status: 403, message: "You don't have access to this." },
  BAD_ORIGIN: { status: 403, message: 'This request came from an unexpected site.' },
  NOT_FOUND: { status: 404, message: "We couldn't find that." },
  CONFLICT: { status: 409, message: 'That conflicts with a change someone else made.' },
  RATE_LIMITED: { status: 429, message: 'Too many attempts. Please wait a minute and try again.' },
  INTERNAL: { status: 500, message: 'Something went wrong on our side. Please try again.' },

  // Sign-in
  SLACK_NOT_CONFIGURED: { status: 503, message: 'Sign in with Slack is not set up yet.' },
  SIGNIN_STATE_MISMATCH: { status: 400, message: 'Your sign-in expired. Please try again.' },
  WRONG_WORKSPACE: { status: 403, message: 'Use the [Company name] Slack workspace.' },
  NOT_IN_DAYBOOK: { status: 403, message: "Your email isn't in Daybook yet. Ask HR to add you." },
  ACCOUNT_DEACTIVATED: { status: 403, message: 'Your account is deactivated.' },

  // Attendance
  ALREADY_CHECKED_IN: { status: 409, message: 'You have already checked in today.' },
  NOT_CHECKED_IN: { status: 409, message: "You haven't checked in today." },
  ALREADY_CHECKED_OUT: { status: 409, message: 'You have already checked out today.' },
  OFFICE_NETWORK_REQUIRED: {
    status: 409,
    message: 'Office check-in only works on the office network.',
  },
  UNVERIFIED_OFFICE_DISABLED: {
    status: 409,
    message: 'Checking in as office without the office network is turned off.',
  },
  ATTENDANCE_EXISTS: { status: 409, message: 'There is already an attendance row for that day.' },
  REQUEST_ALREADY_HANDLED: { status: 409, message: 'Someone already handled this request.' },
  REQUEST_ALREADY_PENDING: { status: 409, message: 'You already have a pending request for this.' },
  ALREADY_ON_BREAK: { status: 409, message: "You're already on a break." },
  NOT_ON_BREAK: { status: 409, message: "You're not on a break." },

  // Project timers
  TIMERS_OFF: { status: 409, message: 'Timers are turned off for your company.' },

  // Reports
  REPORT_LOCKED: { status: 409, message: 'This report is locked. Request an edit to change it.' },
  REPORT_NOT_LOCKED: { status: 409, message: 'This report is still open, so you can edit it now.' },
  REPORT_IN_FUTURE: { status: 400, message: "You can't write a report for a future day." },
  PROJECT_NOT_ACTIVE: { status: 409, message: 'Only active projects can be picked in a report.' },

  // Projects and people
  DUPLICATE_PROJECT: { status: 409, message: 'A project with that name already exists.' },
  DUPLICATE_EMAIL: { status: 409, message: 'Someone with that email is already in Daybook.' },
  DUPLICATE_NETWORK: { status: 409, message: 'That IP address is already saved.' },
  LAST_ADMIN: { status: 409, message: 'Daybook needs at least one active Admin.' },
  SLACK_ERROR: { status: 502, message: "Slack didn't answer. Please try again." },
};

export class AppError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES | string} code
   * @param {{ message?: string, status?: number, fields?: Record<string, string>, cause?: unknown }} [options]
   */
  constructor(code, { message, status, fields, cause } = {}) {
    const known = ERROR_CODES[code] ?? ERROR_CODES.INTERNAL;
    super(message ?? known.message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? known.status;
    this.fields = fields;
  }
}

/** Shorthand for a validation error on specific fields. */
export function validationError(fields, message) {
  return new AppError('VALIDATION_FAILED', { fields, message });
}

export function isAppError(error) {
  return error instanceof AppError;
}
