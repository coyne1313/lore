import chalk from 'chalk';
import {
  getCurrentBranch,
  getGitUser,
  getLastCommitHash,
} from '../lib/git.js';
import { saveEntry } from '../lib/storage.js';
import { parseRef, readFileSnippet } from '../lib/codebase.js';

export async function teachCommand(context, opts) {
  console.log(chalk.cyan('\n  📖 lore teach\n'));

  const author = getGitUser();
  const branch = getCurrentBranch();
  const commitHash = getLastCommitHash();

  // Parse --ref options (can be multiple)
  const refs = [];
  const changedFiles = opts.file ? [opts.file] : [];

  if (opts.ref) {
    const refList = Array.isArray(opts.ref) ? opts.ref : [opts.ref];
    for (const r of refList) {
      const parsed = parseRef(r);
      refs.push(parsed);
      if (!changedFiles.includes(parsed.file)) {
        changedFiles.push(parsed.file);
      }
    }
  }

  // Read code snippets for referenced lines
  let codeSnippets = '';
  for (const ref of refs) {
    const snippet = readFileSnippet(ref.file, ref.startLine, ref.endLine);
    if (snippet) {
      const lineInfo = ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : '';
      codeSnippets += `\n[${ref.file}${lineInfo}]\n${snippet.content}\n`;
    }
  }

  const entry = saveEntry({
    author,
    branch,
    commitHash,
    commitMsg: '[manual entry]',
    changedFiles,
    questions: ['What should teammates know about this?'],
    answers: [context],
    manualContext: context,
    codeRefs: refs.length > 0 ? refs : undefined,
    codeSnippets: codeSnippets || undefined,
    source: 'teach',
  });

  console.log(chalk.green('  ✓ Captured\n'));
  console.log(chalk.gray(`  "${context}"\n`));
  console.log(chalk.gray(`  by ${author} on ${new Date().toLocaleDateString()}`));

  for (const ref of refs) {
    const lineInfo = ref.startLine ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ''}` : '';
    console.log(chalk.gray(`  📌 ${ref.file}${lineInfo}`));
  }

  if (changedFiles.length > 0 && refs.length === 0) {
    console.log(chalk.gray(`  associated with: ${changedFiles.join(', ')}`));
  }
  console.log('');
}
