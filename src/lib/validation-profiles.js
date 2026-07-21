/** @typedef {'strict'|'cataloguing'|'spreadsheet-import'} ValidationProfile */

/** @type {ValidationProfile[]} */
export const VALIDATION_PROFILES = ['strict', 'cataloguing', 'spreadsheet-import'];

/**
 * @param {ValidationProfile} profile
 * @param {import('./marc-validate.js').ValidationIssue} issue
 * @returns {import('./marc-validate.js').ValidationIssue|null}
 */
export function applyValidationProfile(profile, issue) {
  if (profile === 'strict') {
    return issue;
  }

  if (profile === 'spreadsheet-import') {
    if (issue.issueKey === '245-indicators' || issue.message.includes('245 (title) often uses indicators')) {
      return null;
    }
    if (issue.message.includes('unusual for MARC21')) {
      return null;
    }
  }

  if (profile === 'cataloguing') {
    if (issue.message.includes('unusual for MARC21') && issue.level === 'warning') {
      return null;
    }
  }

  return issue;
}

/**
 * @param {ValidationProfile} profile
 * @param {import('./marc-validate.js').ValidationIssue[]} issues
 * @returns {import('./marc-validate.js').ValidationIssue[]}
 */
export function filterIssuesByProfile(profile, issues) {
  return issues
    .map((issue) => applyValidationProfile(profile, issue))
    .filter((issue) => issue != null);
}
