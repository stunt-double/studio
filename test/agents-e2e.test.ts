/**
 * Agents end to end: MCP clients that say they are Codex and Claude Code
 * connect to `stuntdouble mcp` (run from source, so no build races the others), the Studio's agents API lists them,
 * and a run one of them starts names it in run.json and in the Studio's runs.
 * Skipped, saying so, on a machine with no Chrome. No real agent is started.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { RunSchema } from '../src/files.ts';
import { startStudio, type Studio } from '../src/studio.ts';

const PKG = fileURLToPath(new URL('..', import.meta.url));

let site: Server;
let dir: string;
let home: string;
let app: Studio;
let cookie: string;
let host: string;
let chromeMissing = false;
const clients: Client[] = [];

const get = (path: string) =>
  new Promise<string>((ok, bad) => {
    const req = request(
      { host: '127.0.0.1', port: app.ui.port, path, headers: { Host: host, Cookie: cookie } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => ok(body));
      }
    );
    req.on('error', bad);
    req.end();
  });

const connect = async (name: string, version: string) => {
  const client = new Client({ name, version });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(PKG, 'src', 'cli.ts'), 'mcp'],
      env: {
        ...getDefaultEnvironment(),
        STUNTDOUBLE_PROJECT_DIR: dir,
        STUNTDOUBLE_HOME: home,
      },
    })
  );
  clients.push(client);
  return client;
};

const agents = async () =>
  JSON.parse(await get('/api/studio/agents')).agents as Array<{
    kind: string;
    label: string;
    version: string;
  }>;

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  for (let n = 0; n < 100; n++) {
    const v = await read();
    if (done(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return read();
}

before(async () => {
  try {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    await b.close();
  } catch {
    chromeMissing = true;
    return;
  }
  site = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Shop</title><h1>Shop</h1>');
  });
  await new Promise<void>((ok) => site.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  dir = await mkdtemp(join(tmpdir(), 'stuntdouble-agents-e2e-'));
  home = await mkdtemp(join(tmpdir(), 'stuntdouble-agents-home-'));
  process.env.STUNTDOUBLE_HOME = home;
  const sd = join(dir, '.stuntdouble');
  await mkdir(join(sd, 'actors'), { recursive: true });
  await mkdir(join(sd, 'checklists'), { recursive: true });
  await writeFile(
    join(sd, 'stuntdouble.json'),
    JSON.stringify({ format: 'stuntdouble/1', local_base_url: base, headless: true })
  );
  await writeFile(join(sd, 'actors', 'shopper.json'), JSON.stringify({ name: 'Shopper' }));
  await writeFile(
    join(sd, 'checklists', 'shop.json'),
    JSON.stringify({
      name: 'Shop',
      actor: 'shopper',
      url: 'https://shop.example.com/',
      instructions: 'Look at the shop.',
      checks: [{ key: 'heading', description: 'The page has a heading' }],
    })
  );
  app = await startStudio({ project: dir, port: 4832 });
  host = `127.0.0.1:${app.ui.port}`;
  const signIn = await new Promise<string>((ok, bad) => {
    request(
      {
        host: '127.0.0.1',
        port: app.ui.port,
        path: `/?t=${app.ui.token}`,
        headers: { Host: host },
      },
      (res) => {
        res.resume();
        ok(String(res.headers['set-cookie']).split(';')[0]!);
      }
    )
      .on('error', bad)
      .end();
  });
  cookie = signIn;
});

after(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await app?.close();
  site?.close();
  for (const d of [dir, home]) if (d) await rm(d, { recursive: true, force: true });
});

test('Codex and Claude Code connect, run, and are attributed', { timeout: 90_000 }, async (t) => {
  if (chromeMissing) return t.skip('Chrome is not installed');
  assert.deepEqual(await agents(), []);

  const codex = await connect('codex-mcp-client', '0.166.0');
  const claude = await connect('claude-code', '2.1.0');
  const seen = await until(agents, (a) => a.length === 2);
  assert.deepEqual(seen.map((a) => `${a.label} ${a.version}`).sort(), [
    'Claude Code 2.1.0',
    'Codex 0.166.0',
  ]);

  await codex.callTool({ name: 'start_run', arguments: { checklist: 'shop' } });
  await codex.callTool({ name: 'finish_run', arguments: { summary: 'Looked at it.' } });
  const [id] = await readdir(join(dir, '.stuntdouble', 'runs'));
  const run = RunSchema.parse(
    JSON.parse(await readFile(join(dir, '.stuntdouble', 'runs', id!, 'run.json'), 'utf8'))
  );
  assert.deepEqual(run.runner.client, { name: 'codex-mcp-client', version: '0.166.0' });
  const listed = JSON.parse(await get('/api/runs')) as Array<{ runner: { client?: unknown } }>;
  assert.deepEqual(listed[0]!.runner.client, { name: 'codex-mcp-client', version: '0.166.0' });

  // Closing a client removes its entry (stdin closing is the shutdown).
  await claude.close();
  const after1 = await until(agents, (a) => a.length === 1);
  assert.equal(after1[0]!.label, 'Codex');
  await codex.close();
  assert.deepEqual(await until(agents, (a) => a.length === 0), []);
});
