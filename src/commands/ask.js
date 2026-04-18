import chalk from 'chalk';
import ora from 'ora';
import { loadEntries, findRelevantEntries, loadGlobalEntries } from '../lib/storage.js';
import { answerQuestion } from '../lib/ai.js';
import { buildGitContext } from '../lib/git.js';
import { buildCodeContext } from '../lib/codebase.js';
import { vectorSearch, backfillEntries, vectorSearchGlobal, backfillGlobalEntries } from '../lib/vectors.js';

export async function askCommand(question, opts) {
  console.log(chalk.cyan(`\n  📖 lore ask\n`));
  console.log(chalk.gray(`  "${question}"\n`));

  const isGlobal = opts.global || false;

  // Load entries — local or global
  const allEntries = isGlobal
    ? loadGlobalEntries({ file: opts.file, author: opts.author })
    : loadEntries({ file: opts.file, author: opts.author, since: opts.since });

  // Try vector search first, fall back to keyword search
  let relevantEntries = [];
  let searchMethod = 'keyword';

  if (allEntries.length > 0) {
    // Backfill any un-indexed entries
    const backfill = isGlobal ? backfillGlobalEntries : backfillEntries;
    backfill(allEntries).catch(() => {});

    const search = isGlobal ? vectorSearchGlobal : vectorSearch;
    const vectorResults = await search(question);
    if (vectorResults && vectorResults.length > 0) {
      const idSet = new Set(vectorResults.map(r => r.id));
      relevantEntries = allEntries.filter(e => idSet.has(e.id));
      searchMethod = 'vector';
    } else {
      relevantEntries = findRelevantEntries(question, allEntries);
    }
  }

  // Build git context (blame, log history)
  const gitContext = buildGitContext(question);

  // Build code context — auto-enabled, or scoped to specific files
  let codeContext = '';
  if (opts.code !== false) {
    const codeFiles = opts.file ? [opts.file] : undefined;
    codeContext = buildCodeContext(question, { files: codeFiles });
  }

  // If we have nothing at all, tell the user
  if (relevantEntries.length === 0 && !codeContext && !gitContext) {
    console.log(chalk.yellow('  No Lore entries or relevant code found.'));
    console.log(chalk.gray('  Make some commits or use: lore teach <context>\n'));
    return;
  }

  const spinner = ora({
    text: chalk.gray('  Searching knowledge base...'),
    prefixText: '',
    spinner: 'dots',
  }).start();

  let answer;
  try {
    answer = await answerQuestion(question, relevantEntries, gitContext, codeContext);
  } catch (err) {
    spinner.fail(chalk.red('  Failed to get answer'));
    console.error(chalk.gray(`  ${err.message}\n`));
    return;
  }

  spinner.stop();

  // Print answer
  console.log(chalk.white('  ─────────────────────────────────────────'));
  console.log('');
  const lines = answer.split('\n');
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  console.log('');
  console.log(chalk.white('  ─────────────────────────────────────────'));

  // Show provenance
  const sources = [];
  if (relevantEntries.length > 0) sources.push(`${relevantEntries.length} lore entries (${searchMethod})`);
  if (codeContext) sources.push('codebase files');
  if (gitContext) sources.push('git history');
  if (isGlobal) sources.push('cross-repo');
  console.log(chalk.gray(`\n  Based on: ${sources.join(', ')}`));

  const authors = [...new Set(relevantEntries.map(e => e.author).filter(Boolean))];
  if (authors.length > 0) {
    console.log(chalk.gray(`  Contributors: ${authors.join(', ')}`));
  }

  if (isGlobal) {
    const repos = [...new Set(relevantEntries.map(e => e.repo).filter(Boolean))];
    if (repos.length > 0) {
      console.log(chalk.gray(`  Repos: ${repos.join(', ')}`));
    }
  }

  const dateRange = getDateRange(relevantEntries);
  if (dateRange) {
    console.log(chalk.gray(`  Timespan: ${dateRange}`));
  }

  console.log('');
}

function getDateRange(entries) {
  if (entries.length === 0) return null;
  const timestamps = entries.map(e => e.timestamp).filter(Boolean).sort();
  if (timestamps.length === 0) return null;

  const oldest = new Date(timestamps[0]).toLocaleDateString();
  const newest = new Date(timestamps[timestamps.length - 1]).toLocaleDateString();

  return oldest === newest ? oldest : `${oldest} → ${newest}`;
}
