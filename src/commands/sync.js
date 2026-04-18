import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { loadEntries } from '../lib/storage.js';
import { getConfig, updateConfig } from '../lib/storage.js';
import { generateVaultContent } from '../lib/ai.js';

/**
 * Find devnexus vault automatically (looks for the vault structure in parent dirs).
 */
function findDevnexusVault(startDir = process.cwd()) {
  let dir = startDir;
  while (true) {
    // devnexus vault has DECISIONS.md and SESSION_LOG.md
    const decisionsPath = path.join(dir, 'DECISIONS.md');
    const sessionPath = path.join(dir, 'SESSION_LOG.md');
    if (fs.existsSync(decisionsPath) && fs.existsSync(sessionPath)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function syncCommand(opts) {
  console.log(chalk.cyan('\n  📖 lore sync → devnexus\n'));

  const config = getConfig();

  // Resolve vault path
  let vaultPath = opts.vault || config.devnexusVaultPath;

  if (!vaultPath) {
    vaultPath = findDevnexusVault();
    if (vaultPath) {
      console.log(chalk.gray(`  Auto-detected vault at: ${vaultPath}`));
      updateConfig({ devnexusVaultPath: vaultPath });
    }
  }

  if (!vaultPath || !fs.existsSync(vaultPath)) {
    console.log(chalk.yellow('  DevNexus vault not found.'));
    console.log(chalk.gray('  Run: lore sync --vault /path/to/your-vault'));
    console.log(chalk.gray('  Or:  lore init --devnexus\n'));
    return;
  }

  const entries = loadEntries();

  if (entries.length === 0) {
    console.log(chalk.yellow('  No Lore entries to sync yet.\n'));
    return;
  }

  // Get entries since last sync
  const lastSync = config.lastSyncTimestamp || 0;
  const newEntries = entries.filter(e => e.timestamp > lastSync);

  if (newEntries.length === 0) {
    console.log(chalk.green('  ✓ Already up to date\n'));
    return;
  }

  console.log(chalk.gray(`  ${newEntries.length} new entries to sync\n`));

  // ── Update DECISIONS.md ──────────────────────────────────────────────────────
  const decisionsPath = path.join(vaultPath, 'DECISIONS.md');
  const decisionsSpinner = ora({ text: chalk.gray('  Updating DECISIONS.md...'), prefixText: '' }).start();

  try {
    const decisionsContent = await generateVaultContent(newEntries, 'decisions');

    // Append to DECISIONS.md
    const existing = fs.existsSync(decisionsPath)
      ? fs.readFileSync(decisionsPath, 'utf8')
      : '# Decisions\n\n';

    const updated = `${existing.trimEnd()}\n\n<!-- synced from lore ${new Date().toISOString()} -->\n\n${decisionsContent}\n`;
    fs.writeFileSync(decisionsPath, updated);

    decisionsSpinner.succeed(chalk.green('  ✓ DECISIONS.md updated'));
  } catch (err) {
    decisionsSpinner.fail(chalk.red('  DECISIONS.md update failed'));
    console.error(chalk.gray(`  ${err.message}`));
  }

  // ── Update SESSION_LOG.md ────────────────────────────────────────────────────
  const sessionPath = path.join(vaultPath, 'SESSION_LOG.md');
  const sessionSpinner = ora({ text: chalk.gray('  Updating SESSION_LOG.md...'), prefixText: '' }).start();

  try {
    const sessionContent = await generateVaultContent(newEntries.slice(0, 5), 'session_log');

    const sessionEntry = `\n## ${new Date().toLocaleDateString()} — Lore sync\n${sessionContent}\n`;

    const existing = fs.existsSync(sessionPath)
      ? fs.readFileSync(sessionPath, 'utf8')
      : '# Session Log\n';

    fs.writeFileSync(sessionPath, existing.trimEnd() + sessionEntry);

    sessionSpinner.succeed(chalk.green('  ✓ SESSION_LOG.md updated'));
  } catch (err) {
    sessionSpinner.fail(chalk.red('  SESSION_LOG.md update failed'));
    console.error(chalk.gray(`  ${err.message}`));
  }

  // ── Save last sync timestamp ─────────────────────────────────────────────────
  updateConfig({ lastSyncTimestamp: Date.now() });

  console.log(chalk.gray(`\n  Synced ${newEntries.length} entries to ${vaultPath}\n`));
  console.log(chalk.gray('  AI agents using devnexus will now have access to this knowledge.\n'));
}
