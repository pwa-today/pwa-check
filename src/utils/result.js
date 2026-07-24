import { issues } from '../issues.js';

const resolveIssueValue = (value, details) =>
  typeof value === 'function' ? value(details) : value;

export const result = (status, message, code, details = {}) => {
  if (code === undefined) {
    throw new Error(`Result code is required for: ${message}`);
  }

  if (!Object.prototype.hasOwnProperty.call(issues, code)) {
    throw new Error(`Unknown result code: ${code}`);
  }

  const entry = { status, message };
  entry.code = code;
  const issue = issues[code];

  if (status !== 'pass' && issue) {
    entry.priority = issue.priority;
    entry.impact = resolveIssueValue(issue.impact, details);
    entry.fix = resolveIssueValue(issue.fix, details);
    entry.documentation = issue.documentation;
  }

  return entry;
};
