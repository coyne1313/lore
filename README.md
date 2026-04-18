# lore

> Institutional memory for dev teams. Capture intent at commit time. Query it forever.

Lore intercepts your commits and asks 2-3 pointed questions about *why* you made the change — not what (the diff shows that). Answers are stored locally and become queryable knowledge for you and your team.

```
git commit -m "move auth config to global TOML"

  📖 lore — capturing knowledge...

  auth/config.py, settings.toml, db.py

  1. Why move auth config to TOML instead of keeping it per-file?
     → easier to manage across 12 services, single source of truth now

  2. Are there services that haven't migrated yet that need a heads up?
     → yes — payments-service still uses the old pattern, ticket in backlog

  ✓ Captured.
```

A week later:

```
lore ask why did sarah move the auth config

  Based on 3 entries by Sarah from last Tuesday:
  Sarah moved the auth config to a global TOML to create a single source of truth
  across 12 services. She flagged that payments-service still uses the old per-file
  pattern — there's a backlog ticket for it.
```

---

## Install

```bash
npm install -g lore-cli
```

## Setup

```bash
cd your-repo
lore init
```

During init you'll pick your AI provider (Anthropic or OpenAI) and enter your API key. Your next `git commit` triggers the first capture.

---

## AI Providers

Lore supports both Anthropic and OpenAI. Configure during `lore init` or via environment variables:

```bash
# Anthropic (default if both are set)
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
export OPENAI_API_KEY=sk-proj-...

# Force a specific provider when both keys exist
export LORE_PROVIDER=openai
```

---

## Commands

```bash
lore init                         Set up Lore in the current repo
lore ask <question>               Query knowledge + codebase
lore teach <context>              Manually log a piece of knowledge
lore history <file>               Full knowledge history for a file
lore update --confluence <instr>  Generate + push Confluence updates
lore update --jira <instr>        Generate + push Jira updates
lore sync                         Sync to devnexus vault
lore create kt-doc                Generate a KT document
lore create onboarding            Generate an onboarding guide
lore log                          View recent entries
lore log -n 50                    View last 50 entries
```

### lore ask

Lore is codebase-aware — it automatically finds and reads relevant source files, combines them with captured knowledge entries and git history, and gives you answers grounded in actual code.

```bash
lore ask "why did john restructure parser.py"
lore ask "what should i know before touching the auth flow"
lore ask "why are we using TOML instead of env vars"
lore ask --author sarah "what changed last week"
lore ask --file src/db.py "why is connection pooling disabled"
lore ask --no-code "just check lore entries, skip codebase"
```

Options:
- `-f, --file <path>` — scope to a specific file
- `-a, --author <name>` — scope to a specific author
- `--since <date>` — only look at entries since this date
- `--no-code` — disable codebase context (lore entries only)

### lore teach

Capture knowledge that doesn't have a commit attached — architecture decisions, gotchas, context from a meeting. Pin it to specific code with `--ref`.

```bash
# general knowledge
lore teach "we intentionally don't cache auth tokens — security decision from Q3 review"

# associate with a file
lore teach --file src/webhooks.py "the retry logic has a 5-minute cooldown to avoid Stripe rate limits"

# pin to a specific line
lore teach --ref compiler.py:88 "uses a revised auth approach"

# pin to a line range
lore teach --ref src/auth.js:10-25 "retry logic added after prod incident"

# multiple refs
lore teach --ref api.py:44 --ref middleware.py:12 "these two files must stay in sync"
```

Options:
- `-f, --file <path>` — associate with a file
- `-r, --ref <file:line>` — pin to a code reference (repeatable). Formats: `file.py`, `file.py:88`, `file.py:10-25`

Referenced code snippets are stored with the entry, so when someone later asks about that file, the AI has both the knowledge and the exact code being discussed.

### lore history

Full knowledge history for a file — combines git ownership, commit history, and all lore entries into one view.

```bash
# full history for a file
lore history hw4/compiler.py

# zoom into a specific section
lore history hw4/compiler.py:80-120

# limit entries shown
lore history src/auth.js -n 5
```

Output includes:
- **Ownership** — who wrote what (from git blame)
- **Git history** — recent commits touching the file
- **Knowledge** — all lore entries referencing the file, with Q&A and manual annotations

Options:
- `-n, --count <n>` — max lore entries to show (default: 15)

### lore update

```bash
lore update --confluence "update the install guide to show python 3.12 not 3.10"
lore update --jira "update tickets around the auth migration"
lore update --all "mark the TOML config work as complete"
```

### lore create

```bash
lore create kt-doc --project payments-service
lore create onboarding --project my-api --out docs/onboarding.md
lore create runbook
lore create adr
```

### lore sync (devnexus integration)

If your team uses [devnexus](https://github.com/JoshBong/devnexus), Lore can automatically populate your vault's `DECISIONS.md` and `SESSION_LOG.md`:

```bash
lore sync                          # auto-detect vault
lore sync --vault ~/workspace/vault
```

---

## Configuration

Global config lives at `~/.lore/config.json`:

```json
{
  "aiProvider": "openai",
  "openaiApiKey": "sk-proj-...",
  "anthropicApiKey": "sk-ant-...",
  "devnexusVaultPath": "/path/to/vault",
  "confluenceUrl": "https://yourorg.atlassian.net",
  "confluenceToken": "your-token",
  "confluenceSpaceKey": "ENG",
  "jiraUrl": "https://yourorg.atlassian.net",
  "jiraToken": "your-token",
  "jiraProjectKey": "ENG"
}
```

Provider resolution order:
1. `LORE_PROVIDER` env var (explicit choice)
2. `aiProvider` in config
3. Auto-detect from whichever API key is available (Anthropic takes priority if both exist)

---

## How entries are stored

Entries live in `.lore/entries/` in your repo root. By default they're gitignored (knowledge is local to your machine).

To **share knowledge with your team**, remove `.lore/entries/` from `.lore/.gitignore` and commit the entries directory. Everyone on the team then has access to the full knowledge base.

```
.lore/
├── entries/           # one JSON file per commit
│   ├── 1714000000-abc123.json
│   └── ...
├── .gitignore         # entries/ is gitignored by default
└── config.json        # repo-level config
```

Each entry looks like:

```json
{
  "id": "abc123",
  "timestamp": 1714000000000,
  "author": "Sarah Chen",
  "branch": "feature/global-auth-config",
  "commitHash": "a1b2c3d",
  "commitMsg": "move auth config to global TOML",
  "changedFiles": ["auth/config.py", "settings.toml"],
  "questions": [
    "Why TOML instead of keeping config per-file?",
    "Are there services that haven't migrated yet?"
  ],
  "answers": [
    "easier to manage across 12 services, single source of truth",
    "yes — payments-service still uses old pattern, backlog ticket exists"
  ],
  "codeRefs": [{"file": "auth/config.py", "startLine": 44, "endLine": 60}],
  "source": "hook"
}
```

---

## DevNexus integration

Lore pairs naturally with [devnexus](https://github.com/JoshBong/devnexus). DevNexus keeps AI agents informed across sessions — Lore keeps the knowledge base populated with human intent.

```
Dev commits → Lore captures intent → lore sync → devnexus vault
                                                       ↓
                                            AI agents read DECISIONS.md
                                            and SESSION_LOG.md
```

```bash
lore init --devnexus   # configure during setup
lore sync              # push captured knowledge to vault
```

---

## License

MIT
