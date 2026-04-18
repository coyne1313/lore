import { execSync, spawnSync } from 'child_process';
import path from 'path';

/**
 * Run a git command and return stdout. Returns '' on error.
 */
function git(args, cwd = process.cwd()) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Get the root of the current git repo.
 */
export function getRepoRoot() {
  return git('rev-parse --show-toplevel') || process.cwd();
}

/**
 * Get the diff of the last commit (truncated for LLM context).
 */
export function getLastCommitDiff(maxLines = 200) {
  const diff = git('diff HEAD~1 HEAD');
  const lines = diff.split('\n');
  if (lines.length <= maxLines) return diff;

  // Truncate but show file-level stats
  const stat = git('diff HEAD~1 HEAD --stat');
  const truncated = lines.slice(0, maxLines).join('\n');
  return `${stat}\n\n[Diff truncated to ${maxLines} lines]\n\n${truncated}`;
}

/**
 * Get the diff stat of the last commit (just file names + line counts).
 */
export function getLastCommitStat() {
  return git('diff HEAD~1 HEAD --stat');
}

/**
 * Get files changed in the last commit.
 */
export function getLastCommitFiles() {
  const output = git('diff HEAD~1 HEAD --name-only');
  return output ? output.split('\n').filter(Boolean) : [];
}

/**
 * Get the last commit message.
 */
export function getLastCommitMsg() {
  return git('log -1 --pretty=%B').trim();
}

/**
 * Get the last commit hash (short).
 */
export function getLastCommitHash() {
  return git('log -1 --pretty=%h');
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch() {
  return git('rev-parse --abbrev-ref HEAD');
}

/**
 * Get the current git user name.
 */
export function getGitUser() {
  return git('config user.name') || git('config user.email') || 'unknown';
}

/**
 * Get git log for a specific file (for context in `lore ask`).
 */
export function getFileHistory(filePath, maxCommits = 10) {
  return git(`log --oneline -${maxCommits} -- "${filePath}"`);
}

/**
 * Get git blame summary for a file (who wrote what).
 */
export function getBlameAuthors(filePath) {
  const blame = git(`blame --line-porcelain -- "${filePath}"`);
  if (!blame) return [];

  const authorLines = blame.split('\n').filter(l => l.startsWith('author '));
  const counts = {};
  for (const line of authorLines) {
    const author = line.replace('author ', '').trim();
    counts[author] = (counts[author] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([author, lines]) => ({ author, lines }));
}

/**
 * Get recent commits by a specific author.
 */
export function getCommitsByAuthor(authorName, maxCommits = 20) {
  return git(`log --oneline --author="${authorName}" -${maxCommits}`);
}

/**
 * Check if we're inside a git repo.
 */
export function isGitRepo() {
  return git('rev-parse --is-inside-work-tree') === 'true';
}

/**
 * Build a git context string for a question (used to augment RAG answers).
 */
export function buildGitContext(question) {
  const lines = [];

  // If question mentions a specific file, get its history
  const fileMatch = question.match(/[\w/.-]+\.[a-z]{1,5}/i);
  if (fileMatch) {
    const filePath = fileMatch[0];
    const history = getFileHistory(filePath);
    if (history) {
      lines.push(`Recent commits touching ${filePath}:\n${history}`);
    }

    const authors = getBlameAuthors(filePath);
    if (authors.length > 0) {
      const authorStr = authors.map(a => `${a.author} (${a.lines} lines)`).join(', ');
      lines.push(`Main authors of ${filePath}: ${authorStr}`);
    }
  }

  // If question mentions a person's name
  const nameMatch = question.match(/\b[A-Z][a-z]+\b/g);
  if (nameMatch) {
    for (const name of nameMatch.slice(0, 2)) {
      const commits = getCommitsByAuthor(name);
      if (commits) {
        lines.push(`Recent commits by ${name}:\n${commits}`);
      }
    }
  }

  return lines.join('\n\n');
}
