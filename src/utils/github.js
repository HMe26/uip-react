// Same rule as the API (ProjectLink::isValidGithubRepoUrl): https://github.com/{owner}/{repo}
const GITHUB_REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/i;

/** Empty is allowed by callers (the field is optional); this only judges non-empty values. */
export function isValidGithubRepoUrl(url) {
  return GITHUB_REPO_RE.test(String(url || '').trim());
}

export function githubUrlError(locale) {
  return locale === 'ar'
    ? 'اكتب رابط مستودع GitHub صحيح، مثال: https://github.com/username/project'
    : 'Enter a valid GitHub repository URL, e.g. https://github.com/username/project';
}
