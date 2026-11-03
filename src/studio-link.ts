// Studio and the MCP server share one viewer. While Studio is open for a
// project it records itself in `.stuntdouble/.live/studio.json` (url, port,
// pid and the viewer key, written 0600 like `server.json`), and the MCP
// server links Studio's run page instead of starting a second viewer.
//
// This module is in the MCP server's import graph, so it makes no model call
// and starts no process: the probe is a plain loopback HTTP request.

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { z } from 'zod';

import { isAlive, readJson } from './files.ts';

/** Who a viewer serves, without telling an unsigned caller the path: a hash of `.stuntdouble/`'s location. */
export function projectId(root: string): string {
  // Real path: /tmp and /private/tmp (or a symlinked checkout) are one project.
  let real = root;
  try {
    real = realpathSync(root);
  } catch {
    // Not created yet: the path as given.
  }
  return createHash('sha256').update(real).digest('hex').slice(0, 12);
}

export const studioRecord = (root: string): string => join(root, '.live', 'studio.json');

const RecordSchema = z.object({
  url: z.string(),
  port: z.number().int(),
  pid: z.number().int(),
  token: z.string().min(1),
});
export type StudioRecord = z.infer<typeof RecordSchema>;

/** Whether the viewer on `port` answers the identity probe for this project. */
export function probe(port: number, id: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((done) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/__stuntdouble', timeout: timeoutMs },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          try {
            const body = JSON.parse(text) as { stuntdouble?: unknown; project?: unknown };
            done(res.statusCode === 200 && body.stuntdouble === true && body.project === id);
          } catch {
            done(false);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => done(false));
    req.end();
  });
}

/**
 * The Studio open for this project, or null: its record must read, its pid
 * must be alive and its port must answer as this project's viewer. A stale
 * record from a crash fails one of those, and the caller starts its own viewer.
 */
export async function findStudio(root: string): Promise<StudioRecord | null> {
  const record = await readJson(studioRecord(root), RecordSchema).catch(() => null);
  if (!record || !isAlive(record.pid)) return null;
  return (await probe(record.port, projectId(root))) ? record : null;
}

/** A link to `path` on Studio that signs the browser in, as `UiServer.link` does. */
export const studioLink = (record: StudioRecord, path = '/'): string =>
  `${record.url}${path}?t=${record.token}`;
