import chalk from 'chalk';
import { loadEntries } from '../lib/storage.js';

export function logCommand(opts) {
  console.log(chalk.cyan('\n  📖 lore log\n'));

  const entries = loadEntries({
    file: opts.file,
    limit: parseInt(opts.count) || 10,
  });

  if (entries.length === 0) {
    console.log(chalk.yellow('  No entries yet.'));
    console.log(chalk.gray('  Make a commit — Lore will start capturing knowledge.\n'));
    return;
  }

  for (const entry of entries) {
    const date = new Date(entry.timestamp).toLocaleDateString();
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const skippedTag = entry.skipped ? chalk.red(' [skipped]') : '';
    const sourceTag = entry.source === 'teach' ? chalk.cyan(' [manual]') : '';

    console.log(
      chalk.white(`  ${date} ${time}`) +
      chalk.gray(` · ${entry.author || 'unknown'}`) +
      skippedTag +
      sourceTag
    );
    console.log(chalk.gray(`  ${entry.commitMsg}`));

    if (entry.changedFiles?.length > 0) {
      const files = entry.changedFiles.slice(0, 3).join(', ');
      const more = entry.changedFiles.length > 3 ? ` +${entry.changedFiles.length - 3}` : '';
      console.log(chalk.gray(`  → ${files}${more}`));
    }

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

  console.log(chalk.gray(`  Showing ${entries.length} entries. Run lore log -n 50 for more.\n`));
}
