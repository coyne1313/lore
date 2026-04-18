import fs from 'fs';
import path from 'path';
import { getRepoRoot } from './git.js';

const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.scala',
  '.sh', '.bash', '.zsh', '.fish',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss',
  '.md', '.txt', '.env', '.cfg', '.ini', '.conf',
  '.sql', '.graphql', '.proto',
  '.dockerfile', '.tf', '.hcl',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.lore', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.next', '.cache', 'coverage', '.tox', 'target',
]);

/**
 * Read a file and optionally extract a line range.
 * Returns { path, content, startLine, endLine } or null.
 */
export function readFileSnippet(filePath, startLine = null, endLine = null) {
  const repoRoot = getRepoRoot();
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);

  if (!fs.existsSync(fullPath)) return null;

  const stat = fs.statSync(fullPath);
  if (stat.size > 500_000) return null; // skip huge files

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  if (startLine !== null) {
    const start = Math.max(0, startLine - 1); // 1-indexed input
    const end = endLine ? Math.min(lines.length, endLine) : Math.min(start + 50, lines.length);
    const snippet = lines.slice(start, end);
    return {
      path: filePath,
      content: snippet.map((l, i) => `${start + i + 1} | ${l}`).join('\n'),
      startLine: start + 1,
      endLine: end,
      totalLines: lines.length,
    };
  }

  return {
    path: filePath,
    content: lines.map((l, i) => `${i + 1} | ${l}`).join('\n'),
    startLine: 1,
    endLine: lines.length,
    totalLines: lines.length,
  };
}

/**
 * Parse a ref string like "compiler.py:88" or "src/auth.js:10-25"
 * Returns { file, startLine, endLine } or { file } if no lines specified.
 */
export function parseRef(ref) {
  const match = ref.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return { file: ref };

  return {
    file: match[1],
    startLine: match[2] ? parseInt(match[2], 10) : null,
    endLine: match[3] ? parseInt(match[3], 10) : null,
  };
}

/**
 * Walk the repo and collect all source file paths (relative to repo root).
 */
export function listSourceFiles(dir = null, maxFiles = 500) {
  const repoRoot = dir || getRepoRoot();
  const files = [];

  function walk(currentDir, depth = 0) {
    if (depth > 8 || files.length >= maxFiles) return;

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(currentDir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEXT_EXTENSIONS.has(ext) || entry.name === 'Makefile' || entry.name === 'Dockerfile') {
          files.push(path.relative(repoRoot, path.join(currentDir, entry.name)));
        }
      }
    }
  }

  walk(repoRoot);
  return files;
}

/**
 * Find files relevant to a question by matching keywords against file paths.
 */
export function findRelevantFiles(question, maxFiles = 5) {
  const allFiles = listSourceFiles();
  const words = question.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .filter(w => !['the', 'and', 'for', 'how', 'does', 'what', 'why', 'this', 'that', 'with', 'from'].includes(w));

  if (words.length === 0) return [];

  const scored = allFiles.map(filePath => {
    const lower = filePath.toLowerCase();
    const name = path.basename(filePath).toLowerCase();
    let score = 0;

    for (const word of words) {
      if (name.includes(word)) score += 3;
      else if (lower.includes(word)) score += 1;
    }

    return { filePath, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles)
    .map(s => s.filePath);
}

/**
 * Build a code context string for the AI from relevant files.
 * Reads file contents and truncates to stay within token budget.
 */
export function buildCodeContext(question, opts = {}) {
  const sections = [];
  const maxTotalChars = opts.maxChars || 15_000;
  let totalChars = 0;

  // If specific files were requested, use those
  const filesToRead = opts.files
    ? opts.files
    : findRelevantFiles(question);

  if (filesToRead.length === 0) return '';

  for (const filePath of filesToRead) {
    if (totalChars >= maxTotalChars) break;

    const snippet = readFileSnippet(filePath);
    if (!snippet) continue;

    const remaining = maxTotalChars - totalChars;
    let content = snippet.content;
    if (content.length > remaining) {
      const lines = content.split('\n');
      content = lines.slice(0, Math.floor(remaining / 80)).join('\n') + '\n[... truncated]';
    }

    sections.push(`── ${filePath} (${snippet.totalLines} lines) ──\n${content}`);
    totalChars += content.length;
  }

  return sections.join('\n\n');
}
