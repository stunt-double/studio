// The file behind the Studio's secrets: `~/.stuntdouble/credentials.json`
// (mode 0600, in a 0700 folder), never the project's `.stuntdouble/`, never a
// log and never the page. It holds the person's model connection (read only by
// credentials.ts) and their Stunt Double sign-in (read by cloud.ts, which the
// viewer Claude Code opens also imports). This module only reads and writes the
// file: it knows nothing of models or keys (test/no-model.test.ts).

import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const CredentialsSchema = z
  .object({
    /** The model connection: credentials.ts parses it. */
    connection: z.unknown().optional(),
    cloud: z
      .object({
        server: z.string(),
        client: z.record(z.string(), z.unknown()).optional(),
        tokens: z.record(z.string(), z.unknown()).optional(),
        workspace: z.object({ id: z.string(), slug: z.string(), name: z.string() }).nullish(),
      })
      .optional(),
  })
  .loose();
export type Credentials = z.infer<typeof CredentialsSchema>;

export const stuntdoubleHome = (): string =>
  process.env.STUNTDOUBLE_HOME || join(homedir(), '.stuntdouble');
const credentialsFile = () => join(stuntdoubleHome(), 'credentials.json');

export async function readCredentials(): Promise<Credentials> {
  const raw = await readFile(credentialsFile(), 'utf8').catch(() => null);
  if (!raw) return {};
  try {
    const parsed = CredentialsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Written whole, 0600 from the start, in a 0700 folder. */
export async function writeCredentials(credentials: Credentials): Promise<void> {
  const home = stuntdoubleHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  const file = credentialsFile();
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
  await chmod(file, 0o600);
}

export async function updateCredentials(
  change: (current: Credentials) => Credentials
): Promise<Credentials> {
  const next = change(await readCredentials());
  await writeCredentials(next);
  return next;
}

export async function forgetCredentials(): Promise<void> {
  await rm(credentialsFile(), { force: true });
}
