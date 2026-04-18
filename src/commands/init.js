import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';
import { getRepoRoot, isGitRepo } from '../lib/git.js';
import { initLoreDir, saveConfig, getConfig, getConfigPath, registerRepo } from '../lib/storage.js';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

export async function initCommand(opts) {
  console.log(chalk.cyan('  📖 lore init\n'));

  if (!isGitRepo()) {
    console.error(chalk.red('  Error: not inside a git repository.\n'));
    process.exit(1);
  }

  const repoRoot = getRepoRoot();

  // ── 1. AI provider & API key ─────────────────────────────────────────────────
  const existingConfig = getConfig();
  const hasAnthropic = process.env.ANTHROPIC_API_KEY || existingConfig.anthropicApiKey;
  const hasOpenAI = process.env.OPENAI_API_KEY || existingConfig.openaiApiKey;

  if (hasAnthropic || hasOpenAI) {
    const detected = [hasAnthropic && 'Anthropic', hasOpenAI && 'OpenAI'].filter(Boolean).join(' & ');
    console.log(chalk.green(`  ✓ AI key found (${detected})\n`));
  } else {
    console.log(chalk.gray('  Lore uses an AI API to generate questions and answers.'));
    console.log(chalk.gray('  Supported providers: Anthropic, OpenAI\n'));

    let provider;
    while (true) {
      const providerChoice = await prompt(chalk.white('  Provider (anthropic/openai) [anthropic]: '));
      const normalized = providerChoice.toLowerCase().replace(/[^a-z]/g, '');
      if (!normalized || normalized.startsWith('anthro')) {
        provider = 'anthropic';
        break;
      } else if (normalized.startsWith('open')) {
        provider = 'openai';
        break;
      }
      console.log(chalk.yellow(`  "${providerChoice}" isn't recognized. Please type "anthropic" or "openai".`));
    }

    console.log(chalk.gray(`  Using: ${provider}\n`));

    const keyUrl = provider === 'openai'
      ? 'https://platform.openai.com/api-keys'
      : 'https://console.anthropic.com';
    console.log(chalk.gray(`  Get a key at ${keyUrl}\n`));

    const apiKey = await prompt(chalk.white(`  ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key: `));

    if (!apiKey) {
      const envVar = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
      console.log(chalk.yellow('\n  No key provided. You can set it later:'));
      console.log(chalk.gray(`    export ${envVar}=your_key\n`));
    } else {
      // Auto-correct provider if key prefix doesn't match
      let actualProvider = provider;
      if (apiKey.startsWith('sk-proj-') || apiKey.startsWith('sk-org-')) {
        actualProvider = 'openai';
      } else if (apiKey.startsWith('sk-ant-')) {
        actualProvider = 'anthropic';
      }
      if (actualProvider !== provider) {
        console.log(chalk.yellow(`  Key looks like ${actualProvider === 'openai' ? 'OpenAI' : 'Anthropic'} — using that instead.`));
      }
      const keyField = actualProvider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey';
      saveConfig({ ...existingConfig, aiProvider: actualProvider, [keyField]: apiKey });
      console.log(chalk.green(`  ✓ Key saved to ${getConfigPath()}\n`));
    }
  }

  // ── 2. Create .lore/ directory ──────────────────────────────────────────────
  const loreDir = initLoreDir(repoRoot);
  console.log(chalk.green(`  ✓ Created ${path.relative(repoRoot, loreDir)}/`));
  console.log(chalk.gray('    Vector store will auto-initialize on first entry'));

  // ── 2b. Register repo for cross-repo queries ───────────────────────────────
  registerRepo(repoRoot);
  console.log(chalk.green('  ✓ Registered repo for cross-repo queries'));

  // ── 3. Install git hook ─────────────────────────────────────────────────────
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'post-commit');

  // Find where lore is installed
  const loreExecutable = process.argv[1]; // path to bin/lore.js
  const hookContent = `#!/bin/sh
# Lore — institutional memory for dev teams
# https://github.com/your-org/lore
node "${loreExecutable}" _hook
`;

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes('lore')) {
      console.log(chalk.green('  ✓ Git hook already installed'));
    } else {
      // Append to existing hook rather than overwrite
      fs.appendFileSync(hookPath, `\n${hookContent}`);
      console.log(chalk.green('  ✓ Appended to existing post-commit hook'));
    }
  } else {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(hookPath, hookContent);
    fs.chmodSync(hookPath, '755');
    console.log(chalk.green('  ✓ Installed post-commit git hook'));
  }

  // ── 4. devnexus integration ─────────────────────────────────────────────────
  if (opts.devnexus) {
    const vaultPath = await prompt(chalk.white('\n  Path to your devnexus vault: '));
    if (vaultPath && fs.existsSync(vaultPath)) {
      const config = getConfig();
      saveConfig({ ...config, devnexusVaultPath: vaultPath });
      console.log(chalk.green('  ✓ DevNexus vault path saved'));
    } else {
      console.log(chalk.yellow('  Vault path not found — configure later with: lore sync --vault <path>'));
    }
  }

  // ── 5. Add .lore to .gitignore (optional) ──────────────────────────────────
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    if (!gitignore.includes('.lore/entries')) {
      // Don't auto-write, just suggest
      console.log(chalk.gray('\n  Tip: entries are local by default (.lore/.gitignore handles this)'));
      console.log(chalk.gray('  To share with your team, edit .lore/.gitignore and commit entries/'));
    }
  }

  console.log(chalk.cyan('\n  Lore is ready. Your next commit will trigger the first capture.\n'));
  console.log(chalk.gray('  Commands:'));
  console.log(chalk.gray('    lore ask <question>   — query captured knowledge'));
  console.log(chalk.gray('    lore teach <context>  — manually log something'));
  console.log(chalk.gray('    lore log              — view recent entries'));
  console.log(chalk.gray('    lore sync             — push to devnexus vault\n'));
}
