import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getRepoRoot } from './git.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

export function findLoreDir() {
  // Walk up from cwd to find .lore directory (like git does with .git)
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, '.lore');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

export function requireLoreDir() {
  const loreDir = findLoreDir();
  if (!loreDir) {
    console.error('\n  No .lore directory found. Run: lore init\n');
    process.exit(1);
  }
  return loreDir;
}

export function getEntriesDir() {
  return path.join(requireLoreDir(), 'entries');
}

export function getConfigPath() {
  return path.join(os.homedir(), '.lore', 'config.json');
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function getConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

export function saveConfig(config) {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function updateConfig(updates) {
  const current = getConfig();
  saveConfig({ ...current, ...updates });
}

// ─── Entries ──────────────────────────────────────────────────────────────────

/**
 * Save a new Lore entry.
 * Also fires off async vector indexing (non-blocking) to both local and global stores.
 * @param {object} entry
 */
export function saveEntry(entry) {
  const entriesDir = getEntriesDir();
  fs.mkdirSync(entriesDir, { recursive: true });

  const id = crypto.randomBytes(6).toString('hex');
  const filename = `${Date.now()}-${id}.json`;
  const repoName = path.basename(getRepoRoot());
  const fullEntry = { id, ...entry, repo: repoName, timestamp: Date.now() };

  fs.writeFileSync(path.join(entriesDir, filename), JSON.stringify(fullEntry, null, 2));

  // Also save to global store for cross-repo queries
  const globalDir = path.join(os.homedir(), '.lore', 'global', 'entries');
  try {
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, filename), JSON.stringify(fullEntry, null, 2));
  } catch { /* non-critical */ }

  // Index into vector stores (async, dynamic import to avoid circular dep)
  import('./vectors.js').then(({ indexEntry, indexEntryGlobal }) => {
    indexEntry(fullEntry).catch(() => {});
    indexEntryGlobal(fullEntry).catch(() => {});
  }).catch(() => {});

  return fullEntry;
}

/**
 * Load all entries, sorted newest first.
 */
export function loadEntries(opts = {}) {
  const loreDir = findLoreDir();
  if (!loreDir) return [];

  const entriesDir = path.join(loreDir, 'entries');
  if (!fs.existsSync(entriesDir)) return [];

  const files = fs.readdirSync(entriesDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse(); // newest first

  let entries = files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(entriesDir, f), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);

  // Apply filters
  if (opts.file) {
    entries = entries.filter(e =>
      e.changedFiles?.some(f => f.includes(opts.file))
    );
  }

  if (opts.author) {
    entries = entries.filter(e =>
      e.author?.toLowerCase().includes(opts.author.toLowerCase())
    );
  }

  if (opts.since) {
    const sinceTime = new Date(opts.since).getTime();
    entries = entries.filter(e => e.timestamp >= sinceTime);
  }

  if (opts.limit) {
    entries = entries.slice(0, opts.limit);
  }

  return entries;
}

/**
 * Find entries relevant to a question (simple keyword match for MVP).
 * A proper vector search would live here in v2.
 */
export function findRelevantEntries(question, allEntries, maxEntries = 15) {
  const words = question.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)
    // filter out common stop words
    .filter(w => !['what', 'when', 'where', 'which', 'this', 'that', 'with', 'from', 'have', 'does', 'were', 'they', 'their'].includes(w));

  if (words.length === 0) return allEntries.slice(0, maxEntries);

  // Score each entry by keyword matches
  const scored = allEntries.map(entry => {
    const haystack = [
      entry.commitMsg,
      ...(entry.changedFiles || []),
      ...(entry.questions || []),
      ...(entry.answers || []),
      entry.manualContext || '',
    ].join(' ').toLowerCase();

    const score = words.reduce((acc, word) => {
      const count = (haystack.match(new RegExp(word, 'g')) || []).length;
      return acc + count;
    }, 0);

    return { entry, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxEntries)
    .map(s => s.entry);
}

// ─── Init helpers ─────────────────────────────────────────────────────────────

/**
 * Register this repo in the global config so cross-repo queries know about it.
 */
export function registerRepo(repoRoot) {
  const config = getConfig();
  const repos = config.repos || {};
  const name = path.basename(repoRoot);
  repos[name] = { path: repoRoot, registered: new Date().toISOString() };
  saveConfig({ ...config, repos });
}

/**
 * Load entries from the global store (all repos).
 */
export function loadGlobalEntries(opts = {}) {
  const globalDir = path.join(os.homedir(), '.lore', 'global', 'entries');
  if (!fs.existsSync(globalDir)) return [];

  const files = fs.readdirSync(globalDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  let entries = files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(globalDir, f), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);

  if (opts.repo) {
    entries = entries.filter(e =>
      e.repo?.toLowerCase().includes(opts.repo.toLowerCase())
    );
  }

  if (opts.file) {
    entries = entries.filter(e =>
      e.changedFiles?.some(f => f.includes(opts.file))
    );
  }

  if (opts.author) {
    entries = entries.filter(e =>
      e.author?.toLowerCase().includes(opts.author.toLowerCase())
    );
  }

  if (opts.limit) {
    entries = entries.slice(0, opts.limit);
  }

  return entries;
}

export function initLoreDir(repoRoot) {
  const loreDir = path.join(repoRoot, '.lore');
  const entriesDir = path.join(loreDir, 'entries');

  fs.mkdirSync(entriesDir, { recursive: true });

  // Write .gitignore — entries are local by default (team can opt into sharing)
  const gitignorePath = path.join(loreDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath,
`# Lore entries are local by default.
# To share knowledge with your team, comment out the line below
# and commit the entries/ directory to your repo.
entries/

# Vector store (local index, rebuilt automatically)
vectors/
`);
  }

  // Write lore config for this repo
  const repoConfigPath = path.join(loreDir, 'config.json');
  if (!fs.existsSync(repoConfigPath)) {
    fs.writeFileSync(repoConfigPath, JSON.stringify({
      version: '0.1.0',
      created: new Date().toISOString(),
      shareEntries: false, // set to true to commit entries to git
    }, null, 2));
  }

  return loreDir;
}
