#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { initCommand } from '../src/commands/init.js';
import { askCommand } from '../src/commands/ask.js';
import { teachCommand } from '../src/commands/teach.js';
import { updateCommand } from '../src/commands/update.js';
import { syncCommand } from '../src/commands/sync.js';
import { hookCommand } from '../src/hook/post-commit.js';
import { createKtDoc } from '../src/commands/create.js';
import { historyCommand } from '../src/commands/history.js';

console.log(''); // breathing room

/** Helper for repeatable options (e.g. --ref can be used multiple times) */
function collect(val, acc) { acc.push(val); return acc; }

program
  .name('lore')
  .description(chalk.cyan('Institutional memory for dev teams.'))
  .version('0.1.0');

// lore init
program
  .command('init')
  .description('Set up Lore in the current repo')
  .option('--devnexus', 'Also configure devnexus vault sync')
  .action(initCommand);

// lore ask <question>
program
  .command('ask <question...>')
  .description('Ask a question about the codebase')
  .option('-f, --file <path>', 'Scope to a specific file')
  .option('-a, --author <name>', 'Scope to a specific author')
  .option('--since <date>', 'Only look at entries since this date')
  .option('--no-code', 'Disable codebase context (lore entries only)')
  .option('-g, --global', 'Search across all repos')
  .action((question, opts) => askCommand(question.join(' '), opts));

// lore teach <context>
program
  .command('teach <context...>')
  .description('Manually capture a piece of knowledge')
  .option('-f, --file <path>', 'Associate with a specific file')
  .option('-r, --ref <file:line>', 'Pin to a code reference (e.g. auth.py:88 or api.js:10-25)', collect, [])
  .action((context, opts) => teachCommand(context.join(' '), opts));

// lore update
program
  .command('update')
  .description('Update external tools with captured knowledge')
  .option('--jira', 'Update relevant Jira tickets')
  .option('--confluence', 'Update relevant Confluence pages')
  .option('--all', 'Update all configured integrations')
  .argument('[instruction...]', 'What to update and how')
  .action((instruction, opts) => updateCommand(instruction.join(' '), opts));

// lore sync
program
  .command('sync')
  .description('Sync Lore knowledge into devnexus vault')
  .option('--vault <path>', 'Path to devnexus vault (default: auto-detect)')
  .action(syncCommand);

// lore create
program
  .command('create <type>')
  .description('Generate a document from captured knowledge')
  .option('--project <name>', 'Project name to scope the document')
  .option('--out <path>', 'Output file path')
  .action(createKtDoc);

// lore log
program
  .command('log')
  .description('View recent Lore entries')
  .option('-n, --count <n>', 'Number of entries to show', '10')
  .option('-f, --file <path>', 'Filter by file')
  .action(async (opts) => {
    const { logCommand } = await import('../src/commands/log.js');
    logCommand(opts);
  });

// lore history <file>
program
  .command('history <target>')
  .description('Show full knowledge history for a file or code section')
  .option('-n, --count <n>', 'Max lore entries to show', '15')
  .action(historyCommand);

// internal: called by git hook
program
  .command('_hook', { hidden: true })
  .description('Internal: runs after git commit')
  .action(hookCommand);

program.parse();
