import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadEntries } from '../lib/storage.js';
import { generateKtDoc } from '../lib/ai.js';
import { getRepoRoot } from '../lib/git.js';

const SUPPORTED_TYPES = {
  'kt-doc': 'Knowledge Transfer document',
  'onboarding': 'Onboarding guide for new developers',
  'runbook': 'Operational runbook',
  'adr': 'Architecture Decision Record',
};

export async function createKtDoc(type, opts) {
  console.log(chalk.cyan('\n  📖 lore create\n'));

  if (!SUPPORTED_TYPES[type]) {
    console.log(chalk.yellow(`  Unknown document type: ${type}`));
    console.log(chalk.gray('  Supported types:'));
    Object.entries(SUPPORTED_TYPES).forEach(([t, desc]) => {
      console.log(chalk.gray(`    ${t.padEnd(14)} ${desc}`));
    });
    console.log('');
    return;
  }

  const entries = loadEntries();

  if (entries.length === 0) {
    console.log(chalk.yellow('  No Lore entries found yet.'));
    console.log(chalk.gray('  Make some commits first — Lore needs captured knowledge to generate docs.\n'));
    return;
  }

  const projectName = opts.project || path.basename(getRepoRoot());

  console.log(chalk.gray(`  Type: ${SUPPORTED_TYPES[type]}`));
  console.log(chalk.gray(`  Project: ${projectName}`));
  console.log(chalk.gray(`  Drawing from ${entries.length} Lore entries\n`));

  const spinner = ora({ text: chalk.gray('  Generating document...'), prefixText: '' }).start();

  let content;
  try {
    content = await generateKtDoc(entries, projectName);
  } catch (err) {
    spinner.fail(chalk.red('  Document generation failed'));
    console.error(chalk.gray(`  ${err.message}\n`));
    return;
  }

  spinner.stop();

  // Determine output path
  const filename = opts.out || `${type}-${projectName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.md`;
  const outPath = path.resolve(filename);

  fs.writeFileSync(outPath, content);

  console.log(chalk.green(`  ✓ Generated: ${outPath}\n`));

  // Preview first few lines
  const preview = content.split('\n').slice(0, 8).join('\n');
  preview.split('\n').forEach(line => console.log(chalk.gray(`  ${line}`)));
  console.log(chalk.gray('  ...\n'));
}
