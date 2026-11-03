/**
 * The setup API and its guards: the viewer's Host check and key cookie, the
 * Studio's Origin and JSON checks, files confined to `.stuntdouble/` (no
 * symlinks, no other paths), a draft on a scripted model, and the record that
 * lets the MCP server share this viewer.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { startStudio, type Studio } from '../src/studio.ts';
import { makeProject, pkg } from './helpers/project.ts';

let dir: string;
let home: string;
let app: Studio;
let cookie: string;
let host: string;
let modelReplies: string[] = [];
let modelCalls = 0;
let devUp = true;

const KEY = 'sk-secret-test-key';

/** Answers the model's chat completions from a script, and the dev server probe. */
const fakeFetch = (async (url: string | URL) => {
  const target = String(url);
  if (target.startsWith('http://model.test/')) {
    const content = modelReplies[modelCalls++] ?? 'nothing more';
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 800, completion_tokens: 200, cost: 0.003 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  if (devUp && target === 'http://localhost:3000') return new Response('<h1>Hi</h1>');
  throw new TypeError('fetch failed');
}) as unknown as typeof fetch;

type Reply = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

function call(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: app.ui.port,
        path,
        method: options.method ?? 'GET',
        headers: { Host: host, ...options.headers },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text }));
      }
    );
    req.on('error', reject);
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

const get = (path: string) => call(path, { headers: { Cookie: cookie } });
const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  call(path, {
    method: 'POST',
    body,
    headers: {
      Cookie: cookie,
      Origin: `http://${host}`,
      'Content-Type': 'application/json',
      ...extra,
    },
  });

before(async () => {
  dir = await makeProject({
    'package.json': pkg({
      name: 'mug-shop',
      scripts: { dev: 'next dev' },
      dependencies: { next: '16' },
    }),
    'pnpm-lock.yaml': '',
    'README.md': '# Mug Shop\n\nMugs for people who love mugs.',
    'app/page.tsx': '',
    'app/pricing/page.tsx': '',
    'app/sign-up/page.tsx': '',
  });
  home = await mkdtemp(join(tmpdir(), 'stuntdouble-home-'));
  process.env.STUNTDOUBLE_HOME = home;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await writeFile(
    join(home, 'credentials.json'),
    JSON.stringify({
      connection: {
        provider: 'openai',
        model: 'scripted',
        base_url: 'http://model.test/v1',
        api_key: KEY,
      },
    }),
    { mode: 0o600 }
  );
  app = await startStudio({ project: dir, port: 4850, fetch: fakeFetch });
  host = `127.0.0.1:${app.ui.port}`;
  const signIn = await call(`/?t=${app.ui.token}`);
  cookie = String(signIn.headers['set-cookie']).split(';')[0]!;
});

after(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

test('every setup route needs the key cookie and this server as the Host', async () => {
  assert.equal((await call('/api/studio/setup/detect')).status, 403);
  assert.equal(
    (await call('/api/studio/setup/detect', { headers: { Host: 'evil.example', Cookie: cookie } }))
      .status,
    403
  );
  for (const path of ['probe', 'draft', 'write']) {
    const noCookie = await call(`/api/studio/setup/${path}`, {
      method: 'POST',
      body: {},
      headers: { Origin: `http://${host}`, 'Content-Type': 'application/json' },
    });
    assert.equal(noCookie.status, 403, `${path} without the cookie`);
  }
});

test('writes need this server as the Origin and a JSON body, and send no CORS headers', async () => {
  for (const path of ['probe', 'draft', 'write']) {
    const url = `/api/studio/setup/${path}`;
    assert.equal(
      (
        await call(url, {
          method: 'POST',
          body: {},
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        })
      ).status,
      403,
      `${path} with no Origin`
    );
    assert.equal(
      (await post(url, {}, { Origin: 'https://evil.example' })).status,
      403,
      `${path} from another site`
    );
    assert.equal((await post(url, {}, { 'Content-Type': 'text/plain' })).status, 415, path);
  }
  const ok = await get('/api/studio/setup/detect');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], undefined);
  // GET is only for detect; nothing else answers it, and a PUT does nothing.
  assert.equal((await get('/api/studio/setup/write')).status, 404);
});

test('detect: the dev server, the pages, the README and the model, never the key', async () => {
  const res = await get('/api/studio/setup/detect');
  const data = JSON.parse(res.body);
  assert.deepEqual(
    { framework: data.dev.framework, command: data.dev.command, url: data.dev.url },
    { framework: 'Next.js', command: 'pnpm dev', url: 'http://localhost:3000' }
  );
  assert.deepEqual(
    data.routes.map((r: { path: string }) => r.path),
    ['/', '/pricing', '/sign-up']
  );
  assert.equal(data.product.name, 'Mug Shop');
  assert.deepEqual(data.connection, { provider: 'openai', model: 'scripted' });
  assert.ok(!res.body.includes(KEY), 'the key never leaves the server');
});

test('probe: up, down with the command that starts it, and a bad address', async () => {
  devUp = true;
  const up = JSON.parse(
    (await post('/api/studio/setup/probe', { url: 'http://localhost:3000' })).body
  );
  assert.equal(up.reachable, true);
  devUp = false;
  const down = JSON.parse(
    (await post('/api/studio/setup/probe', { url: 'http://localhost:3000' })).body
  );
  assert.equal(down.reachable, false);
  assert.match(down.message, /Start it with `pnpm dev`/);
  devUp = true;
  const bad = await post('/api/studio/setup/probe', { url: 'javascript:alert(1)' });
  assert.equal(bad.status, 422);
  assert.equal(JSON.parse(bad.body).issues[0].path, 'url');
});

test('draft: templates need no model; a model draft retries once; failures say so', async () => {
  const template = await post('/api/studio/setup/draft', {
    url: 'http://localhost:3000',
    mode: 'template',
  });
  assert.equal(template.status, 200);
  const t = JSON.parse(template.body);
  assert.equal(t.usage, null);
  assert.deepEqual(
    t.files.map((f: { path: string }) => f.path),
    [
      'stuntdouble.json',
      'actors/first-time-visitor.json',
      'checklists/first-look.json',
      'checklists/sign-up.json',
      'checklists/pricing.json',
      '.gitignore',
    ]
  );
  const calls = modelCalls;
  assert.equal(calls, 0, 'templates make no model call');

  // A model draft: the first reply is not valid, the second is.
  const valid = {
    actor: {
      slug: 'gift-buyer',
      name: 'Gift buyer',
      description: 'Buys a mug as a gift',
      knowledge: [],
      persist_login: false,
    },
    checklists: [
      {
        slug: 'first-look',
        name: 'First look',
        actor: 'gift-buyer',
        url: 'http://localhost:3000/',
        instructions: 'Find a mug.',
        checks: [
          { key: 'a-mug-is-visible', description: 'A mug is visible on the home page' },
          { key: 'price-shown', description: 'Each mug shows a price' },
          { key: 'buy-button', description: 'There is a buy button' },
        ],
      },
      {
        slug: 'pricing',
        name: 'Pricing',
        actor: 'gift-buyer',
        url: 'http://localhost:3000/pricing',
        instructions: 'Read the prices.',
        checks: [
          { key: 'prices-listed', description: 'Prices are listed' },
          { key: 'currency-stated', description: 'The currency is stated' },
          { key: 'shipping-stated', description: 'Shipping is stated' },
        ],
      },
    ],
  };
  modelReplies = ['{"actor": {}}', JSON.stringify(valid)];
  modelCalls = 0;
  const model = await post('/api/studio/setup/draft', {
    url: 'http://localhost:3000',
    description: 'Someone buying a gift',
    mode: 'model',
  });
  assert.equal(model.status, 200, model.body);
  const m = JSON.parse(model.body);
  assert.equal(modelCalls, 2);
  assert.deepEqual(m.usage, {
    model: 'scripted',
    attempts: 2,
    input_tokens: 1600,
    output_tokens: 400,
    cost_usd: 0.006,
  });
  assert.deepEqual(
    m.files.map((f: { path: string }) => f.path),
    [
      'stuntdouble.json',
      'actors/gift-buyer.json',
      'checklists/first-look.json',
      'checklists/pricing.json',
      '.gitignore',
    ]
  );
  assert.ok(!model.body.includes(KEY));

  // Still invalid after the retry: a 422 that points at the templates.
  modelReplies = ['nope', 'still nope'];
  modelCalls = 0;
  const failed = await post('/api/studio/setup/draft', {
    url: 'http://localhost:3000',
    mode: 'model',
  });
  assert.equal(failed.status, 422);
  assert.equal(modelCalls, 2);
  assert.equal(JSON.parse(failed.body).template, true);
  assert.match(JSON.parse(failed.body).error, /even after a retry/);

  // A bad address, and a model draft with no model connection.
  assert.equal(
    (await post('/api/studio/setup/draft', { url: 'nope', mode: 'template' })).status,
    422
  );
  await rm(join(home, 'credentials.json'));
  const none = await post('/api/studio/setup/draft', {
    url: 'http://localhost:3000',
    mode: 'model',
  });
  assert.equal(none.status, 400);
  assert.match(JSON.parse(none.body).error, /Connect a model first/);
});

const write = (files: Array<{ path: string; content: string }>) =>
  post('/api/studio/setup/write', { files });

test('write: paths outside the setup files, bad JSON and missing actors are refused, with nothing written', async () => {
  const draft = JSON.parse(
    (await post('/api/studio/setup/draft', { url: 'http://localhost:3000', mode: 'template' })).body
  ).files as Array<{ path: string; content: string }>;
  const sd = join(dir, '.stuntdouble');

  for (const path of [
    '../escape.json',
    'runs/x/run.json',
    '.live/server.json',
    'CLAUDE.md',
    '.claude/settings.json',
    'hooks.json',
    '/etc/passwd',
  ]) {
    const res = await write([...draft, { path, content: '{}' }]);
    assert.equal(res.status, 422, path);
    assert.equal(JSON.parse(res.body).issues[0].path, `files.${path}`);
  }
  const broken = await write(
    draft.map((f) =>
      f.path === 'actors/first-time-visitor.json' ? { ...f, content: '{"name": ' } : f
    )
  );
  assert.equal(broken.status, 422);
  assert.equal(JSON.parse(broken.body).issues[0].path, 'files.actors/first-time-visitor.json');
  const orphan = await write(draft.filter((f) => !f.path.startsWith('actors/')));
  assert.equal(orphan.status, 422);
  assert.equal((await post('/api/studio/setup/write', { files: 'x' })).status, 400);
  assert.equal(
    await stat(sd).then(
      () => true,
      () => false
    ),
    false,
    'nothing was written'
  );
  assert.equal(
    await stat(join(dir, '..', 'escape.json')).then(
      () => true,
      () => false
    ),
    false
  );
});

test('write: a symlink on the way in is refused before any file is written', async () => {
  const draft = JSON.parse(
    (await post('/api/studio/setup/draft', { url: 'http://localhost:3000', mode: 'template' })).body
  ).files as Array<{ path: string; content: string }>;
  const outside = await mkdtemp(join(tmpdir(), 'stuntdouble-outside-'));
  const sd = join(dir, '.stuntdouble');
  await mkdir(sd, { recursive: true });
  await symlink(outside, join(sd, 'checklists'));
  const res = await write(draft);
  assert.equal(res.status, 422);
  assert.match(res.body, /symlink/);
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readdir(join(sd)), ['checklists']);
  await rm(join(sd, 'checklists'));
  await rm(outside, { recursive: true, force: true });
});

test('write: the files, the config last, a record for the MCP server, and a second write refused', async () => {
  const draft = JSON.parse(
    (await post('/api/studio/setup/draft', { url: 'http://localhost:3000', mode: 'template' })).body
  ).files as Array<{ path: string; content: string }>;
  const sd = join(dir, '.stuntdouble');
  assert.equal(JSON.parse((await get('/api/studio')).body).initialised, false);
  assert.equal(
    await stat(join(sd, '.live', 'studio.json')).then(
      () => true,
      () => false
    ),
    false
  );

  // The person edits a check in the preview before writing.
  const edited = draft.map((f) =>
    f.path === 'checklists/first-look.json'
      ? { ...f, content: f.content.replace('says-what-it-is', 'says-what-it-sells') }
      : f
  );
  const res = await write(edited);
  assert.equal(res.status, 200, res.body);
  const written = JSON.parse(res.body).written as string[];
  assert.equal(written.at(-1), 'stuntdouble.json', 'the config is written last');
  assert.deepEqual(new Set(written), new Set(draft.map((f) => f.path)));
  assert.match(
    await readFile(join(sd, 'checklists', 'first-look.json'), 'utf8'),
    /says-what-it-sells/
  );
  assert.equal(await readFile(join(sd, '.gitignore'), 'utf8'), '.live/\n');
  assert.equal((await stat(join(sd, 'actors', 'first-time-visitor.json'))).mode & 0o777, 0o600);
  // Studio does not touch the agent's files.
  for (const path of ['CLAUDE.md', '.claude']) {
    assert.equal(
      await stat(join(dir, path)).then(
        () => true,
        () => false
      ),
      false,
      path
    );
  }
  assert.equal(JSON.parse((await get('/api/studio')).body).initialised, true);

  // The record the MCP server reads: same shape and mode as .live/server.json.
  const record = join(sd, '.live', 'studio.json');
  assert.equal((await stat(record)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(record, 'utf8')), {
    url: `http://127.0.0.1:${app.ui.port}`,
    port: app.ui.port,
    pid: process.pid,
    token: app.ui.token,
  });

  const again = await write(draft);
  assert.equal(again.status, 409);
  assert.equal(
    (await post('/api/studio/setup/draft', { url: 'http://localhost:3000', mode: 'template' }))
      .status,
    409
  );
});

test('the page script carries the setup flow, and the build copies it', async () => {
  const script = await get('/studio.js');
  assert.equal(script.status, 200);
  assert.match(script.body, /sd\.renderSetup = /);
  assert.match(script.body, /sd\.studio = \{/);
  assert.match(
    await readFile(new URL('../tsup.config.ts', import.meta.url), 'utf8'),
    /studio-setup\.js/
  );
});

test('closing the Studio removes its record', async () => {
  const record = join(dir, '.stuntdouble', '.live', 'studio.json');
  assert.ok(await stat(record));
  await app.close();
  assert.equal(
    await stat(record).then(
      () => true,
      () => false
    ),
    false
  );
  app = await startStudio({ project: dir, port: 4850, fetch: fakeFetch });
  assert.ok(await stat(record), 'a Studio opened on a set-up project records itself at once');
});
