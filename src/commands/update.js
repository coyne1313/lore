import chalk from 'chalk';
import ora from 'ora';
import { loadEntries } from '../lib/storage.js';
import { generateUpdate } from '../lib/ai.js';
import { getConfig } from '../lib/storage.js';

export async function updateCommand(instruction, opts) {
  console.log(chalk.cyan('\n  📖 lore update\n'));

  if (!instruction) {
    console.log(chalk.yellow('  Please provide an instruction, e.g.:'));
    console.log(chalk.gray('    lore update --confluence update the install guide to use python 3.12'));
    console.log('');
    return;
  }

  const config = getConfig();
  const entries = loadEntries({ limit: 30 });

  if (entries.length === 0) {
    console.log(chalk.yellow('  No Lore entries found yet.\n'));
    return;
  }

  const targets = [];
  if (opts.jira || opts.all) targets.push('Jira');
  if (opts.confluence || opts.all) targets.push('Confluence');

  if (targets.length === 0) {
    console.log(chalk.yellow('  Specify a target: --jira, --confluence, or --all\n'));
    return;
  }

  console.log(chalk.gray(`  Instruction: "${instruction}"`));
  console.log(chalk.gray(`  Targets: ${targets.join(', ')}\n`));

  for (const target of targets) {
    const spinner = ora({
      text: chalk.gray(`  Generating ${target} update...`),
      prefixText: '',
    }).start();

    let content;
    try {
      content = await generateUpdate(instruction, entries, target);
    } catch (err) {
      spinner.fail(chalk.red(`  Failed to generate ${target} update`));
      console.error(chalk.gray(`  ${err.message}\n`));
      continue;
    }

    spinner.stop();

    console.log(chalk.white(`\n  ── ${target} ──────────────────────────────────`));
    console.log('');
    content.split('\n').forEach(line => console.log(`  ${line}`));
    console.log('');

    // Check if integration credentials are configured
    if (target === 'Confluence') {
      const hasCredentials = config.confluenceUrl && config.confluenceToken;
      if (hasCredentials) {
        await pushToConfluence(content, instruction, config);
      } else {
        console.log(chalk.yellow('  Confluence credentials not configured.'));
        console.log(chalk.gray('  To auto-push, add to ~/.lore/config.json:'));
        console.log(chalk.gray('    confluenceUrl, confluenceToken, confluenceSpaceKey\n'));
        console.log(chalk.gray('  Content above is ready to paste manually.\n'));
      }
    }

    if (target === 'Jira') {
      const hasCredentials = config.jiraUrl && config.jiraToken;
      if (hasCredentials) {
        await pushToJira(content, instruction, config);
      } else {
        console.log(chalk.yellow('  Jira credentials not configured.'));
        console.log(chalk.gray('  To auto-push, add to ~/.lore/config.json:'));
        console.log(chalk.gray('    jiraUrl, jiraToken, jiraProjectKey\n'));
        console.log(chalk.gray('  Content above is ready to paste manually.\n'));
      }
    }
  }
}

// ── Confluence integration ───────────────────────────────────────────────────

async function pushToConfluence(content, instruction, config) {
  const spinner = ora({ text: chalk.gray('  Pushing to Confluence...'), prefixText: '' }).start();

  try {
    // Search for the relevant page
    const searchUrl = `${config.confluenceUrl}/rest/api/content/search?cql=space=${config.confluenceSpaceKey}+AND+type=page+AND+text~"${encodeURIComponent(instruction.split(' ').slice(0, 3).join(' '))}"&limit=5`;

    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${config.confluenceToken}`,
        'Content-Type': 'application/json',
      },
    });

    const searchData = await searchResponse.json();
    const pages = searchData.results || [];

    if (pages.length === 0) {
      spinner.warn(chalk.yellow('  No matching Confluence page found'));
      console.log(chalk.gray('  Create a page manually and run again, or check your space key.\n'));
      return;
    }

    // For now, show which page we'd update (write protection on first run)
    spinner.stop();
    console.log(chalk.green(`  ✓ Found ${pages.length} matching page(s):`));
    pages.forEach(p => {
      console.log(chalk.gray(`    - ${p.title} (${config.confluenceUrl}/wiki${p._links?.webui || ''})`));
    });
    console.log(chalk.yellow('\n  Auto-update is a destructive operation.'));
    console.log(chalk.gray('  Review the content above, then run with --confirm to push.\n'));

    // TODO: implement actual page update with --confirm flag
  } catch (err) {
    spinner.fail(chalk.red('  Confluence push failed'));
    console.error(chalk.gray(`  ${err.message}\n`));
  }
}

// ── Jira integration ─────────────────────────────────────────────────────────

async function pushToJira(content, instruction, config) {
  const spinner = ora({ text: chalk.gray('  Searching Jira...'), prefixText: '' }).start();

  try {
    // Search for relevant tickets
    const keywords = instruction.split(' ').filter(w => w.length > 4).slice(0, 3).join(' ');
    const jqlQuery = `project = ${config.jiraProjectKey} AND text ~ "${keywords}" ORDER BY updated DESC`;
    const searchUrl = `${config.jiraUrl}/rest/api/3/issue/search?jql=${encodeURIComponent(jqlQuery)}&maxResults=5`;

    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${config.jiraToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    const issues = data.issues || [];

    spinner.stop();

    if (issues.length === 0) {
      console.log(chalk.yellow('  No matching Jira tickets found.\n'));
      return;
    }

    console.log(chalk.green(`  ✓ Found ${issues.length} relevant ticket(s):`));
    issues.forEach(issue => {
      console.log(chalk.gray(`    - [${issue.key}] ${issue.fields?.summary}`));
    });
    console.log(chalk.yellow('\n  Review content above, then run with --confirm to add as comments.\n'));

    // TODO: implement actual comment creation with --confirm flag
  } catch (err) {
    spinner.fail(chalk.red('  Jira search failed'));
    console.error(chalk.gray(`  ${err.message}\n`));
  }
}
