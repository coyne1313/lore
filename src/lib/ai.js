import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getConfig } from './storage.js';

let _client = null;
let _provider = null;

/**
 * Resolve which AI provider to use and return a configured client.
 * Priority: env vars → config file. Supports 'anthropic' and 'openai'.
 */
function resolveProvider() {
  if (_client && _provider) return { client: _client, provider: _provider };

  const config = getConfig();

  // Check env vars first, then config
  const anthropicKey = process.env.ANTHROPIC_API_KEY || config.anthropicApiKey;
  const openaiKey = process.env.OPENAI_API_KEY || config.openaiApiKey;
  const configuredProvider = (process.env.LORE_PROVIDER || config.aiProvider || '').toLowerCase();

  // Explicit provider choice
  if (configuredProvider === 'openai' && openaiKey) {
    _provider = 'openai';
    _client = new OpenAI({ apiKey: openaiKey });
    return { client: _client, provider: _provider };
  }

  if (configuredProvider === 'anthropic' && anthropicKey) {
    _provider = 'anthropic';
    _client = new Anthropic({ apiKey: anthropicKey });
    return { client: _client, provider: _provider };
  }

  // Auto-detect from available keys
  if (anthropicKey) {
    _provider = 'anthropic';
    _client = new Anthropic({ apiKey: anthropicKey });
    return { client: _client, provider: _provider };
  }

  if (openaiKey) {
    _provider = 'openai';
    _client = new OpenAI({ apiKey: openaiKey });
    return { client: _client, provider: _provider };
  }

  console.error('\n  No AI API key found.');
  console.error('  Run: export ANTHROPIC_API_KEY=your_key');
  console.error('  Or:  export OPENAI_API_KEY=your_key');
  console.error('  Or:  lore init  (to configure interactively)\n');
  process.exit(1);
}

const MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
};

/**
 * Unified chat completion across providers.
 * Returns the text content of the first response.
 */
async function chat(prompt, maxTokens = 600) {
  const { client, provider } = resolveProvider();

  if (provider === 'anthropic') {
    const response = await client.messages.create({
      model: MODELS.anthropic,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content[0].text.trim();
  }

  // openai
  const response = await client.chat.completions.create({
    model: MODELS.openai,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.choices[0].message.content.trim();
}

/**
 * Generate 2-3 pointed questions about a git diff to capture developer intent.
 */
export async function generateQuestions(diff, commitMsg, changedFiles) {
  const prompt = `You are helping capture institutional knowledge from a software developer right after they made a commit.

Commit message: "${commitMsg}"

Changed files: ${changedFiles.join(', ')}

Diff summary:
${diff}

Generate exactly 2-3 short, pointed questions to ask the developer RIGHT NOW to capture:
- Why they made this change (intent, not mechanics)
- Any non-obvious decisions, trade-offs, or gotchas
- Anything a future developer would need to know that isn't obvious from the code

Rules:
- Ask about WHY and WHAT TO WATCH OUT FOR, not what (the diff shows that)
- Each question must be specific to THIS diff, not generic
- Keep each question under 15 words
- Do NOT ask "what did you change" — we can see that
- If the diff is trivial (typo fix, formatting), generate only 1 question or return SKIP

Respond with ONLY a JSON array of question strings, like:
["Question one?", "Question two?", "Question three?"]

Or if trivial: "SKIP"`;

  const text = await chat(prompt, 300);

  if (text === 'SKIP') return null;

  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return null;
  }
}

/**
 * Answer a developer's question using captured Lore entries.
 */
export async function answerQuestion(question, entries, gitContext = '', codeContext = '') {
  const entriesText = entries
    .map((e, i) => {
      const qas = e.questions
        .map((q, j) => `  Q: ${q}\n  A: ${e.answers[j] || '(not answered)'}`)
        .join('\n');
      return `--- Entry ${i + 1} ---
Date: ${new Date(e.timestamp).toLocaleDateString()}
Author: ${e.author}
Commit: ${e.commitMsg}
Files changed: ${e.changedFiles.join(', ')}
${qas}
${e.manualContext ? `Context: ${e.manualContext}` : ''}`;
    })
    .join('\n\n');

  const prompt = `You are Lore, an institutional memory tool for a software development team. You have access to knowledge captured from developers right after they made commits — their intent, trade-offs, and gotchas. You can also read the actual source code.

CAPTURED KNOWLEDGE:
${entriesText || 'No entries found yet.'}

${codeContext ? `SOURCE CODE:\n${codeContext}` : ''}

${gitContext ? `GIT CONTEXT:\n${gitContext}` : ''}

DEVELOPER QUESTION: "${question}"

Answer the question using the captured knowledge AND source code. Be specific and direct. Reference specific files, line numbers, and function names when relevant. If you can identify WHO made a decision and WHY, say so. If the knowledge base doesn't have enough info to answer confidently, say what you DO know and what's uncertain. 

Format: plain conversational text, no markdown headers. 2-4 sentences unless the question demands more detail.`;

  return chat(prompt, 600);
}

/**
 * Generate a KT doc from captured entries.
 */
export async function generateKtDoc(entries, projectName) {
  const entriesText = entries
    .map((e) => {
      const qas = e.questions
        .map((q, j) => `- ${q}\n  → ${e.answers[j] || '(not answered)'}`)
        .join('\n');
      return `${new Date(e.timestamp).toLocaleDateString()} | ${e.author} | ${e.commitMsg}\nFiles: ${e.changedFiles.join(', ')}\n${qas}`;
    })
    .join('\n\n---\n\n');

  const prompt = `You are generating a Knowledge Transfer (KT) document for the project "${projectName}" based on developer intent captured over time.

CAPTURED KNOWLEDGE:
${entriesText}

Generate a comprehensive KT document in Markdown that includes:
1. Project overview (inferred from the changes)
2. Key architectural decisions and WHY they were made
3. Known gotchas and non-obvious things to watch out for
4. Frequently changed areas and why
5. Important context for a new developer joining the team

Write it as if you're a senior developer handing off to a new teammate. Be specific, not generic.`;

  return chat(prompt, 2000);
}

/**
 * Generate a Confluence/Jira update based on instruction and entries.
 */
export async function generateUpdate(instruction, entries, targetType) {
  const entriesText = entries
    .slice(-20)
    .map((e) => {
      const qas = e.questions
        .map((q, j) => `  - ${q}: ${e.answers[j] || 'N/A'}`)
        .join('\n');
      return `${e.commitMsg} (${e.author}, ${new Date(e.timestamp).toLocaleDateString()})\n${qas}`;
    })
    .join('\n\n');

  const prompt = `You are helping a developer update ${targetType} documentation based on recent code changes.

INSTRUCTION: "${instruction}"

RECENT CAPTURED KNOWLEDGE:
${entriesText}

Generate the updated content for ${targetType}. Be specific, accurate, and only include what's relevant to the instruction. Use ${targetType === 'Confluence' ? 'Confluence wiki markup' : 'plain text suitable for Jira'} formatting.`;

  return chat(prompt, 1000);
}

/**
 * Synthesize Lore entries into devnexus vault format.
 */
export async function generateVaultContent(entries, section) {
  const entriesText = entries
    .map((e) => {
      const qas = e.questions
        .map((q, j) => `  - ${q}: ${e.answers[j] || 'N/A'}`)
        .join('\n');
      return `${e.commitMsg} | ${e.author} | ${new Date(e.timestamp).toLocaleDateString()}\nFiles: ${e.changedFiles.join(', ')}\n${qas}`;
    })
    .join('\n\n');

  const prompts = {
    decisions: `Based on the following captured developer knowledge, extract and format key architectural decisions and rejected approaches for a DECISIONS.md file (devnexus vault format).

Format each decision as:
## [Date] Decision: [brief title]
**Context:** what situation led to this
**Decision:** what was decided
**Reasoning:** why
**Consequences:** what to watch out for

KNOWLEDGE:
${entriesText}`,

    session_log: `Based on the following recent developer knowledge captures, write a SESSION_LOG.md entry (2-3 sentences max) summarizing what changed recently and what a developer picking this up should know first.

KNOWLEDGE:
${entriesText}`,
  };

  return chat(prompts[section], 1500);
}
