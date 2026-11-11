/**
 * @file The `.search/` index packs carry: a SQLite FTS5 database and a manifest, in the layout of
 * `Pack-GitFiles.ps1 -AddIndex` (index schema 4, manifest schema 3).
 * @see {@link ../docs/packs.md#outbound-packs | File exchange: packs}
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decodeText } from '@co-reiner/core';

// What the index includes, as in Pack-GitFiles.ps1.
const TEXT_EXTENSIONS = new Set(
  '.cs .cshtml .config .css .csv .graphql .htm .html .ini .js .json .jsx .md .mjs .cjs .props .ps1 .psd1 .psm1 .py .razor .scss .sln .sql .svg .targets .toml .ts .tsx .txt .xml .yaml .yml'.split(
    ' ',
  ),
);
const TEXT_FILENAMES = new Set(
  '.editorconfig .eslintignore .eslintrc .gitattributes .gitignore .npmrc .prettierignore .prettierrc Dockerfile Makefile'.split(
    ' ',
  ),
);
const EXCLUDED_PARTS = new Set(
  '.git .next bin build coverage dist node_modules obj packages storybook-static'.split(' '),
);
const MAX_INDEXED_SIZE = 10 * 1024 * 1024;

function isIndexCandidate(file: string, size: number): boolean {
  const parts = file.split('/');
  const name = parts[parts.length - 1] ?? '';
  if (size > MAX_INDEXED_SIZE) return false;
  if (parts.slice(0, -1).some((p) => EXCLUDED_PARTS.has(p.toLowerCase()))) return false;
  return TEXT_FILENAMES.has(name) || TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** node:sqlite prints an ExperimentalWarning on load, which would land in the middle of the TUI. */
async function loadSqlite(): Promise<typeof import('node:sqlite')> {
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (/SQLite/i.test(text)) return;
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return await import('node:sqlite');
  } finally {
    process.emitWarning = original;
  }
}

export async function buildIndex(
  entries: { file: string; data: Uint8Array }[],
  archiveName: string,
): Promise<{ db: Uint8Array; manifest: Uint8Array; indexed: number }> {
  const { DatabaseSync } = await loadSqlite();
  // mkdtemp: a name nobody can guess, made for this run only (it holds the project's text for a moment).
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reiner-index-'));
  const dbFile = path.join(dir, 'index.sqlite');
  const db = new DatabaseSync(dbFile);
  try {
    db.exec(`
      PRAGMA journal_mode=DELETE;
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE files (
        id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, crc INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL, uncompressed_size INTEGER NOT NULL, encoding TEXT NOT NULL,
        content TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE files_fts USING fts5(path, content, content='files', content_rowid='id',
        tokenize='unicode61 remove_diacritics 2');
      CREATE VIRTUAL TABLE files_trigram USING fts5(path, content, content='files', content_rowid='id',
        tokenize='trigram');
      CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(rowid, path, content) VALUES (new.id, new.path, new.content);
        INSERT INTO files_trigram(rowid, path, content) VALUES (new.id, new.path, new.content);
      END;
    `);
    const insert = db.prepare(
      'INSERT INTO files(path, sha256, crc, compressed_size, uncompressed_size, encoding, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    let indexed = 0;
    db.exec('BEGIN');
    for (const { file, data } of entries) {
      if (!isIndexCandidate(file, data.length)) continue;
      const decoded = decodeText(data);
      if (!decoded) continue;
      const sha = createHash('sha256').update(data).digest('hex');
      // crc and compressed size are not known before zipping; 0 marks them as unavailable.
      insert.run(file, sha, 0, 0, data.length, decoded.encoding, decoded.text);
      indexed++;
    }
    const updated = new Date().toISOString();
    const meta = db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries({
      schema_version: '4',
      archive_file_name: archiveName,
      updated_utc: updated,
      generator: 'Reiner',
      indexed_files: String(indexed),
      maximum_file_size: String(MAX_INDEXED_SIZE),
    }))
      meta.run(k, v);
    db.exec('COMMIT');
    db.exec("INSERT INTO files_fts(files_fts) VALUES ('optimize')");
    db.exec("INSERT INTO files_trigram(files_trigram) VALUES ('optimize')");
    db.close();
    const manifest = {
      schemaVersion: 3,
      archiveFileName: archiveName,
      updatedUtc: updated,
      indexType: 'SQLite FTS5',
      indexEntry: '.search/index.sqlite',
      tokenizers: ['unicode61 remove_diacritics 2', 'trigram'],
      indexedFiles: indexed,
      checkedFiles: entries.length,
      changedFiles: indexed,
      unchangedFiles: 0,
      removedFiles: 0,
      skippedFiles: entries.length - indexed,
      maximumFileSizeBytes: MAX_INDEXED_SIZE,
      indexModified: true,
    };
    return {
      db: new Uint8Array(await readFile(dbFile)),
      manifest: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
      indexed,
    };
  } finally {
    if (db.isOpen) db.close();
    await rm(dir, { recursive: true, force: true });
  }
}
