// The Studio's setup API (`/api/studio/setup/*`), behind the same guards as
// every Studio route: loopback Host, the key cookie, and for writes this
// server's Origin and a JSON body (studio.ts checks those before calling in).
//
// It reads the project's own files (package.json, the README, route folders),
// asks the dev server one GET, drafts, and writes only the files setup.ts
// accepts, only under `.stuntdouble/`, never through a symlink.

import { lstat, readdir } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { basename, join } from 'node:path';
import { z } from 'zod';

import type { Connection } from './credentials.ts';
import { sdDir, writeFileAtomic } from './files.ts';
import { DraftError, draftWithModel } from './setup-draft.ts';
import {
  checkSetupFiles,
  detectDevServer,
  discoverRoutes,
  draftFiles,
  exists,
  parseWebUrl,
  probeDevServer,
  readProduct,
  templateDraft,
  type DraftContext,
} from './setup.ts';
import { send } from './ui-server.ts';

const json = (res: ServerResponse, status: number, data: unknown) =>
  send(res, status, JSON.stringify(data), 'application/json');

const UrlInput = z.object({ url: z.string().max(2000) });
const DraftInput = z.object({
  url: z.string().max(2000),
  description: z.string().trim().max(500).optional(),
  mode: z.enum(['model', 'template']),
});
const WriteInput = z.object({
  files: z.array(z.object({ path: z.string().max(200), content: z.string() })).max(40),
});

export type SetupOptions = {
  project: string;
  fetch?: typeof fetch;
  /** The connection a draft may use: configured and able to make a call, or null. */
  connection(): Promise<Connection | null>;
  /** Called after the files are written, for the Studio to record itself. */
  written?(): Promise<void>;
};

export function setupRoutes(options: SetupOptions) {
  const { project } = options;
  const root = sdDir(project);

  const initialised = () => exists(join(root, 'stuntdouble.json'));

  async function context(url: string, description?: string): Promise<DraftContext> {
    return {
      url,
      description,
      routes: await discoverRoutes(project),
      product: await readProduct(project),
    };
  }

  async function detect(res: ServerResponse): Promise<void> {
    const [dev, routes, product, connection] = await Promise.all([
      detectDevServer(project),
      discoverRoutes(project),
      readProduct(project),
      options.connection(),
    ]);
    json(res, 200, {
      project,
      name: basename(project),
      dev,
      routes,
      product: {
        name: product.name,
        description: product.description,
        readme: product.readme.slice(0, 600),
      },
      connection: connection ? { provider: connection.provider, model: connection.model } : null,
    });
  }

  async function probe(res: ServerResponse, body: unknown): Promise<void> {
    const input = UrlInput.safeParse(body);
    if (!input.success || !parseWebUrl(input.data.url)) {
      return json(res, 422, {
        issues: [{ path: 'url', message: 'Enter a web address, http or https' }],
      });
    }
    const dev = await detectDevServer(project);
    json(
      res,
      200,
      await probeDevServer(input.data.url, { fetch: options.fetch, command: dev.command })
    );
  }

  async function draft(res: ServerResponse, body: unknown): Promise<void> {
    const input = DraftInput.safeParse(body);
    const url = input.success ? parseWebUrl(input.data.url) : null;
    if (!input.success || !url) {
      return json(res, 422, {
        issues: [{ path: 'url', message: 'Enter a web address, http or https' }],
      });
    }
    if (await initialised()) return json(res, 409, { error: 'This project is already set up.' });
    const ctx = await context(url.href, input.data.description);
    if (input.data.mode === 'template') {
      return json(res, 200, {
        mode: 'template',
        files: draftFiles(templateDraft(ctx)),
        usage: null,
      });
    }
    const connection = await options.connection();
    if (!connection) {
      return json(res, 400, { error: 'Connect a model first: Settings, then Connection.' });
    }
    try {
      const result = await draftWithModel({ connection, context: ctx, fetch: options.fetch });
      json(res, 200, {
        mode: 'model',
        files: draftFiles(result.draft),
        usage: {
          model: connection.model,
          attempts: result.attempts,
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          cost_usd: result.usage.cost_usd,
        },
      });
    } catch (err) {
      json(res, 422, {
        error:
          err instanceof DraftError
            ? `${err.message} The templates are still there.`
            : `The model call failed: ${(err as Error).message}`,
        template: true,
      });
    }
  }

  async function write(res: ServerResponse, body: unknown): Promise<void> {
    const input = WriteInput.safeParse(body);
    if (!input.success) return json(res, 400, { error: 'Send {"files": [{path, content}]}.' });
    if (await initialised()) return json(res, 409, { error: 'This project is already set up.' });
    const { files } = input.data;
    const actors = new Set(
      (await readdir(join(root, 'actors')).catch(() => [] as string[]))
        .filter((n) => n.endsWith('.json'))
        .map((n) => basename(n, '.json'))
    );
    const issues = checkSetupFiles(files, actors);
    // Never over a file that is already there: the person may have written it.
    for (const file of files) {
      if (file.path !== 'stuntdouble.json' && file.path !== '.gitignore') {
        if (await exists(join(root, file.path))) {
          issues.push({ path: `files.${file.path}`, message: 'This file already exists' });
        }
      }
    }
    // A link anywhere on the way in could send a write outside `.stuntdouble/`: check them all first.
    for (const file of files) {
      const parts = ['', ...file.path.split('/')];
      for (let n = 0; n < parts.length; n++) {
        const here = join(root, ...parts.slice(0, n + 1));
        if ((await lstat(here).catch(() => null))?.isSymbolicLink()) {
          issues.push({
            path: `files.${file.path}`,
            message: 'Refusing to write through a symlink',
          });
          break;
        }
      }
    }
    if (issues.length) return json(res, 422, { issues });
    const written: string[] = [];
    // The config goes last: a project counts as set up once it exists.
    const ordered = [...files].sort(
      (a, b) => Number(a.path === 'stuntdouble.json') - Number(b.path === 'stuntdouble.json')
    );
    for (const file of ordered) {
      if (file.path === '.gitignore' && (await exists(join(root, file.path)))) continue;
      await writeFileAtomic(join(root, file.path), file.content);
      written.push(file.path);
    }
    await options.written?.();
    json(res, 200, { written });
  }

  return {
    /** A GET under the setup prefix. Returns false for a path that is not one. */
    async get(path: string, res: ServerResponse): Promise<boolean> {
      if (path !== '/api/studio/setup/detect') return false;
      await detect(res);
      return true;
    },
    /** A write under the setup prefix, already past the Origin and JSON checks. */
    async post(path: string, body: unknown, res: ServerResponse): Promise<boolean> {
      if (path === '/api/studio/setup/probe') await probe(res, body);
      else if (path === '/api/studio/setup/draft') await draft(res, body);
      else if (path === '/api/studio/setup/write') await write(res, body);
      else return false;
      return true;
    },
  };
}
