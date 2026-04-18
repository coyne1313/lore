import readline from 'readline';
import chalk from 'chalk';
import {
  getLastCommitDiff,
  getLastCommitFiles,
  getLastCommitMsg,
  getLastCommitHash,
  getCurrentBranch,
  getGitUser,
} from '../lib/git.js';
import { generateQuestions } from '../lib/ai.js';
import { saveEntry, findLoreDir } from '../lib/storage.js';

/**
 * Prompt the user with a question and return their answer.
 */
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * The main hook logic — runs after each git commit.
 */
export async function hookCommand() {
  // Silently exit if lore isn't initialized in this repo
  const loreDir = findLoreDir();
  if (!loreDir) return;

  const changedFiles = getLastCommitFiles();
  const commitMsg = getLastCommitMsg();
  const commitHash = getLastCommitHash();
  const branch = getCurrentBranch();
  const author = getGitUser();

  // Skip merge commits
  if (commitMsg.startsWith('Merge ')) return;

  // Skip empty commits
  if (changedFiles.length === 0) return;

  console.log(chalk.cyan('\n  📖 lore') + chalk.gray(' — capturing knowledge...\n'));

  let questions;
  try {
    const diff = getLastCommitDiff(150);
    questions = await generateQuestions(diff, commitMsg, changedFiles);
  } catch (err) {
    // Never block a commit — silently fail if LLM is unavailable
    if (process.env.LORE_DEBUG) {
      console.error(chalk.gray(`  [lore] question generation failed: ${err.message}`));
    }
    return;
  }

  // LLM decided this commit is trivial
  if (!questions || questions.length === 0) {
    console.log(chalk.gray('  (trivial commit — nothing to capture)\n'));
    return;
  }

  console.log(chalk.gray(`  ${changedFiles.slice(0, 3).join(', ')}${changedFiles.length > 3 ? ` +${changedFiles.length - 3} more` : ''}`));
  console.log(chalk.gray('  Answer in one sentence. Press enter to skip.\n'));

  const answers = [];

  for (let i = 0; i < questions.length; i++) {
    const answer = await prompt(
      chalk.yellow(`  ${i + 1}. ${questions[i]}\n`) +
      chalk.white('     → ')
    );
    answers.push(answer);
    console.log('');
  }

  // Don't save if dev skipped everything
  const hasAnswers = answers.some(a => a.length > 0);

  saveEntry({
    author,
    branch,
    commitHash,
    commitMsg,
    changedFiles,
    questions,
    answers,
    skipped: !hasAnswers,
    source: 'hook',
  });

  if (hasAnswers) {
    console.log(chalk.green('  ✓ Captured.\n'));
  } else {
    console.log(chalk.gray('  (skipped — logged as undocumented commit)\n'));
  }
}
