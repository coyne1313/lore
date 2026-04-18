import chalk from 'chalk';
import { loadEntries } from '../lib/storage.js';
import { getFileHistory, getBlameAuthors } from '../lib/git.js';
import { parseRef, readFileSnippet } from '../lib/codebase.js';

export function historyCommand(target, opts) {
  console.log(chalk.cyan('\n  📖 lore history\n'));

  const ref = parseRef(target);
  const filePath = ref.file;

  // ── 1. Git history ──────────────────────────────────────────────────────────
  const gitLog = getFileHistory(filePath, 20);
  if (!gitLog) {
    console.log(chalk.yellow(`  No git history found for ${filePath}`));
    console.log(chalk.gray('  Check the path and make sure the file is tracked.\n'));
    return;
  }

  console.log(chalk.white(`  ${filePath}\n`));

  // ── 2. Ownership ────────────────────────────────────────────────────────────
  const authors = getBlameAuthors(filePath);
  if (authors.length > 0) {
    console.log(chalk.gray('  Ownership:'));
    for (const a of authors.slice(0, 5)) {
      const pct = ref.startLine ? '' : ` (${a.lines} lines)`;
      console.log(chalk.gray(`    ${a.author}${pct}`));
    }
    console.log('');
  }

  // ── 3. Git commits ─────────────────────────────────────────────────────────
  console.log(chalk.gray('  Git history:'));
  for (const line of gitLog.split('\n').slice(0, 10)) {
    console.log(chalk.gray(`    ${line}`));
  }
  console.log('');

  // ── 4. Lore entries for this file ───────────────────────────────────────────
  const entries = loadEntries({ file: filePath });

  if (entries.length === 0) {
    console.log(chalk.gray('  No lore entries reference this file yet.'));
    console.log(chalk.gray(`  Tip: lore teach --ref ${filePath} "your context here"\n`));
    return;
  }

  console.log(chalk.white(`  Knowledge (${entries.length} entries):\n`));

  for (const entry of entries.slice(0, parseInt(opts.count) || 15)) {
    const date = new Date(entry.timestamp).toLocaleDateString();
    const sourceTag = entry.source === 'teach' ? chalk.cyan(' [manual]') : '';

    console.log(
      chalk.white(`  ${date}`) +
      chalk.gray(` · ${entry.author || 'unknown'}`) +
      sourceTag
    );
    console.log(chalk.gray(`  ${entry.commitMsg}`));

    // Show code refs if they exist
    if (entry.codeRefs) {
      for (const r of entry.codeRefs) {
        const lineInfo = r.startLine ? `:${r.startLine}${r.endLine ? `-${r.endLine}` : ''}` : '';
        console.log(chalk.gray(`  📌 ${r.file}${lineInfo}`));
      }
    }

    // Show Q&A
    if (!entry.skipped && entry.questions?.length > 0) {
      for (let i = 0; i < entry.questions.length; i++) {
        const answer = entry.answers?.[i];
        if (answer) {
          console.log(chalk.gray(`  Q: ${entry.questions[i]}`));
          console.log(chalk.white(`  A: ${answer}`));
        }
      }
    }

    if (entry.manualContext) {
      console.log(chalk.white(`  "${entry.manualContext}"`));
    }

    console.log('');
  }

  // ── 5. Show snippet if line range requested ─────────────────────────────────
  if (ref.startLine) {
    const snippet = readFileSnippet(filePath, ref.startLine, ref.endLine);
    if (snippet) {
      console.log(chalk.white('  Code:'));
      for (const line of snippet.content.split('\n').slice(0, 20)) {
        console.log(chalk.gray(`    ${line}`));
      }
      console.log('');
    }
  }
}
