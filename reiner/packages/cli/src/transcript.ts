/**
 * @file This run's transcript: what was said and done, one JSON line each, under `.reiner/sessions/`.
 * @see {@link ../../../docs/architecture/project-config.md | Project configuration and the `.reiner/` folder}
 */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'event';
  text: string;
  harness?: string;
  model?: string;
  stopped?: boolean;
  elapsedMs?: number;
}

export interface Transcript {
  file: string;
  append(entry: TranscriptEntry): Promise<void>;
}

export function createTranscript(sessionsDir: string): Transcript {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(sessionsDir, id);
  const file = path.join(dir, 'transcript.jsonl');
  return {
    file,
    // Never rejects: callers do not wait for it, and an unwritable transcript must not end the session.
    async append(entry) {
      try {
        await mkdir(dir, { recursive: true });
        await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
      } catch {}
    },
  };
}
