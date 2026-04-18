import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import os from 'os';
import { findLoreDir } from './storage.js';
import { getConfig } from './storage.js';

let _db = null;
let _globalDb = null;
const TABLE_NAME = 'entries';
const EMBEDDING_DIM = 1536; // text-embedding-3-small (OpenAI) or similar

// ─── Database connection ──────────────────────────────────────────────────────

async function getDb() {
  if (_db) return _db;

  const loreDir = findLoreDir();
  if (!loreDir) return null;

  const dbPath = path.join(loreDir, 'vectors');
  _db = await lancedb.connect(dbPath);
  return _db;
}

async function getGlobalDb() {
  if (_globalDb) return _globalDb;

  const globalPath = path.join(os.homedir(), '.lore', 'global', 'vectors');
  _globalDb = await lancedb.connect(globalPath);
  return _globalDb;
}

async function getOrCreateTable(db) {
  const tableNames = await db.tableNames();
  if (tableNames.includes(TABLE_NAME)) {
    return db.openTable(TABLE_NAME);
  }
  return null;
}

// ─── Embedding ────────────────────────────────────────────────────────────────

/**
 * Build the text string we embed for a lore entry.
 */
function entryToText(entry) {
  const parts = [
    entry.commitMsg || '',
    ...(entry.questions || []),
    ...(entry.answers || []),
    entry.manualContext || '',
    ...(entry.changedFiles || []),
  ];
  return parts.filter(Boolean).join(' ').slice(0, 8000);
}

/**
 * Get embeddings from the configured AI provider.
 * Returns an array of float arrays (one per input text).
 */
async function getEmbeddings(texts) {
  const config = getConfig();
  const anthropicKey = process.env.ANTHROPIC_API_KEY || config.anthropicApiKey;
  const openaiKey = process.env.OPENAI_API_KEY || config.openaiApiKey;
  const provider = (process.env.LORE_PROVIDER || config.aiProvider || '').toLowerCase();

  // OpenAI embeddings (preferred — cheaper and purpose-built)
  if ((provider === 'openai' && openaiKey) || (!provider && openaiKey)) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: openaiKey });
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    return response.data.map(d => d.embedding);
  }

  // Anthropic doesn't have an embeddings API — use Voyage AI via Anthropic's recommendation,
  // or fall back. For simplicity, if only Anthropic key is available, we use a simple
  // hash-based embedding as a fallback (not semantic, but enables the pipeline).
  if (anthropicKey && !openaiKey) {
    // Fallback: deterministic pseudo-embeddings from text hashing.
    // This gives basic deduplication but NOT semantic search.
    // Users should add an OpenAI key for real vector search.
    return texts.map(t => hashEmbed(t));
  }

  return null;
}

/**
 * Simple deterministic hash-based embedding fallback.
 * NOT semantic — just enables the storage pipeline when no embedding API is available.
 */
function hashEmbed(text, dim = EMBEDDING_DIM) {
  const vec = new Float64Array(dim);
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    for (let i = 0; i < dim; i++) {
      vec[i] += Math.sin(hash * (i + 1)) / words.length;
    }
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec.map(v => v / norm));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Index a single lore entry into the vector store.
 * Called after saveEntry().
 */
export async function indexEntry(entry) {
  try {
    const db = await getDb();
    if (!db) return false;

    const text = entryToText(entry);
    const embeddings = await getEmbeddings([text]);
    if (!embeddings) return false;

    const record = {
      id: entry.id,
      vector: embeddings[0],
      text,
      author: entry.author || '',
      timestamp: entry.timestamp || Date.now(),
      commitMsg: entry.commitMsg || '',
      files: (entry.changedFiles || []).join(', '),
      source: entry.source || 'hook',
    };

    const table = await getOrCreateTable(db);
    if (table) {
      await table.add([record]);
    } else {
      await db.createTable(TABLE_NAME, [record]);
    }

    return true;
  } catch (err) {
    if (process.env.LORE_DEBUG) {
      console.error(`[lore] vector indexing failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Search the vector store for entries relevant to a query.
 * Returns an array of { id, text, author, commitMsg, files, score }.
 * Falls back to null if vector search is unavailable.
 */
export async function vectorSearch(query, limit = 15) {
  try {
    const db = await getDb();
    if (!db) return null;

    const table = await getOrCreateTable(db);
    if (!table) return null;

    const embeddings = await getEmbeddings([query]);
    if (!embeddings) return null;

    const results = await table
      .vectorSearch(embeddings[0])
      .limit(limit)
      .toArray();

    return results.map(r => ({
      id: r.id,
      text: r.text,
      author: r.author,
      commitMsg: r.commitMsg,
      files: r.files,
      timestamp: r.timestamp,
      score: r._distance,
    }));
  } catch (err) {
    if (process.env.LORE_DEBUG) {
      console.error(`[lore] vector search failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Backfill: index all entries that aren't yet in the vector store.
 * Called lazily when the user runs a command while online.
 */
export async function backfillEntries(entries) {
  try {
    const db = await getDb();
    if (!db) return 0;

    const table = await getOrCreateTable(db);
    const existingIds = new Set();

    if (table) {
      const all = await table.query().select(['id']).toArray();
      for (const row of all) existingIds.add(row.id);
    }

    const missing = entries.filter(e => !existingIds.has(e.id));
    if (missing.length === 0) return 0;

    // Batch embed (up to 100 at a time to stay within API limits)
    let indexed = 0;
    const batchSize = 100;

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const texts = batch.map(e => entryToText(e));
      const embeddings = await getEmbeddings(texts);
      if (!embeddings) break;

      const records = batch.map((entry, j) => ({
        id: entry.id,
        vector: embeddings[j],
        text: texts[j],
        author: entry.author || '',
        timestamp: entry.timestamp || Date.now(),
        commitMsg: entry.commitMsg || '',
        files: (entry.changedFiles || []).join(', '),
        source: entry.source || 'hook',
      }));

      if (table) {
        await table.add(records);
      } else {
        await db.createTable(TABLE_NAME, records);
      }

      indexed += records.length;
    }

    return indexed;
  } catch (err) {
    if (process.env.LORE_DEBUG) {
      console.error(`[lore] backfill failed: ${err.message}`);
    }
    return 0;
  }
}

/**
 * Check if the vector store exists and has data.
 */
export async function hasVectorStore() {
  try {
    const db = await getDb();
    if (!db) return false;
    const table = await getOrCreateTable(db);
    return table !== null;
  } catch {
    return false;
  }
}

// ─── Global (cross-repo) operations ──────────────────────────────────────────

/**
 * Index a single entry into the global (cross-repo) vector store.
 */
export async function indexEntryGlobal(entry) {
  try {
    const db = await getGlobalDb();
    if (!db) return false;

    const text = entryToText(entry);
    const embeddings = await getEmbeddings([text]);
    if (!embeddings) return false;

    const record = {
      id: entry.id,
      vector: embeddings[0],
      text,
      author: entry.author || '',
      timestamp: entry.timestamp || Date.now(),
      commitMsg: entry.commitMsg || '',
      files: (entry.changedFiles || []).join(', '),
      repo: entry.repo || '',
      source: entry.source || 'hook',
    };

    const table = await getOrCreateTable(db);
    if (table) {
      await table.add([record]);
    } else {
      await db.createTable(TABLE_NAME, [record]);
    }

    return true;
  } catch (err) {
    if (process.env.LORE_DEBUG) {
      console.error(`[lore] global vector indexing failed: ${err.message}`);
    }
    return false;
  }
}

/**
 * Search the global vector store across all repos.
 */
export async function vectorSearchGlobal(query, limit = 15) {
  try {
    const db = await getGlobalDb();
    if (!db) return null;

    const table = await getOrCreateTable(db);
    if (!table) return null;

    const embeddings = await getEmbeddings([query]);
    if (!embeddings) return null;

    const results = await table
      .vectorSearch(embeddings[0])
      .limit(limit)
      .toArray();

    return results.map(r => ({
      id: r.id,
      text: r.text,
      author: r.author,
      commitMsg: r.commitMsg,
      files: r.files,
      repo: r.repo,
      timestamp: r.timestamp,
      score: r._distance,
    }));
  } catch (err) {
    if (process.env.LORE_DEBUG) {
      console.error(`[lore] global vector search failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * Backfill global store with entries from all repos.
 */
export async function backfillGlobalEntries(entries) {
  try {
    const db = await getGlobalDb();
    if (!db) return 0;

    const table = await getOrCreateTable(db);
    const existingIds = new Set();

    if (table) {
      const all = await table.query().select(['id']).toArray();
      for (const row of all) existingIds.add(row.id);
    }

    const missing = entries.filter(e => !existingIds.has(e.id));
    if (missing.length === 0) return 0;

    let indexed = 0;
    const batchSize = 100;

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const texts = batch.map(e => entryToText(e));
      const embeddings = await getEmbeddings(texts);
      if (!embeddings) break;

      const records = batch.map((entry, j) => ({
        id: entry.id,
        vector: embeddings[j],
        text: texts[j],
        author: entry.author || '',
        timestamp: entry.timestamp || Date.now(),
        commitMsg: entry.commitMsg || '',
        files: (entry.changedFiles || []).join(', '),
        repo: entry.repo || '',
        source: entry.source || 'hook',
      }));

      if (table) {
        await table.add(records);
      } else {
        await db.createTable(TABLE_NAME, records);
      }

      indexed += records.length;
    }

    return indexed;
  } catch (err) {
    if (process.env.LORE_DEBUG) {
      console.error(`[lore] global backfill failed: ${err.message}`);
    }
    return 0;
  }
}
