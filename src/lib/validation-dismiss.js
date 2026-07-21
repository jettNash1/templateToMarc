/** @typedef {import('./marc-validate.js').ValidationIssue} ValidationIssue */

/**
 * Dismiss key for an entire warning type (all records sharing the same issue).
 * @param {ValidationIssue} issue
 * @returns {string}
 */
export function getWarningTypeDismissKey(issue) {
  return issue.issueKey ?? issue.message;
}

/** @deprecated Use getWarningTypeDismissKey */
export function getIssueDismissKey(issue) {
  return getWarningTypeDismissKey(issue);
}

/**
 * @param {string} issueKey
 * @returns {boolean}
 */
export function isDismissableIssueKey(issueKey) {
  return Boolean(issueKey);
}

/**
 * @param {ValidationIssue} issue
 * @returns {boolean}
 */
export function isDismissableIssue(issue) {
  return issue.level === 'warning';
}

/**
 * @param {ValidationIssue} issue
 * @param {Set<string>|readonly string[]} dismissedKeys
 * @returns {boolean}
 */
export function isIssueDismissed(issue, dismissedKeys) {
  if (!isDismissableIssue(issue)) {
    return false;
  }
  const keys = dismissedKeys instanceof Set ? dismissedKeys : new Set(dismissedKeys);
  return keys.has(getWarningTypeDismissKey(issue));
}

/**
 * Active issues for badges, highlights, and summary counts (dismissed warnings excluded).
 * @param {ValidationIssue[]} issues
 * @param {Set<string>|readonly string[]} dismissedKeys
 * @returns {ValidationIssue[]}
 */
export function getActiveValidationIssues(issues, dismissedKeys) {
  const keys = dismissedKeys instanceof Set ? dismissedKeys : new Set(dismissedKeys);
  return issues.filter(
    (issue) => issue.level === 'error' || !keys.has(getWarningTypeDismissKey(issue)),
  );
}

/**
 * Remove dismissal keys that no longer match any current warning type.
 * @param {Set<string>} dismissedKeys
 * @param {ValidationIssue[]} issues
 * @returns {boolean} whether the set changed
 */
export function pruneDismissedWarnings(dismissedKeys, issues) {
  const validKeys = new Set(
    issues.filter((issue) => issue.level === 'warning').map(getWarningTypeDismissKey),
  );
  let changed = false;
  for (const key of dismissedKeys) {
    if (!validKeys.has(key)) {
      dismissedKeys.delete(key);
      changed = true;
    }
  }
  return changed;
}
