/**
 * One viewer link, end to end: `stuntdouble studio` is open for a project, an
 * MCP client (Claude Code's side) calls start_run, finish_run and open_ui over
 * stdio, and every link points at Studio's own port. Nothing else is started.
 * When Studio goes away, the next link is the MCP server's own viewer again.
 * Skipped, saying so, on a machine with no Chrome.
 *
 * Both processes run from source (Node strips the types), so no build is needed.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { makeProject } from './helpers/project.ts';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(PKG, 'src', 'cli.ts');

let site: Server;
let dir: string;
let home: string;
let studio: ChildProcess;
let studioPort: number;
let client: Client | undefined;
let chromeMissing = false;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  );

before(async () => {
  try {
    await (await chromium.launch({ channel: 'chrome', headless: true })).close();
  } catch {
    chromeMissing = true;
    return;
  }
  site = createServer((_req, res) => {
    res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end('<title>Mug Shop</title><h1>Mug Shop</h1>');
  });
  await new Promise<void>((ok) => site.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  dir = await makeProject({
    '.stuntdouble/stuntdouble.json': JSON.stringify({ format: 'stuntdouble/1', headless: true }),
    '.stuntdouble/actors/shopper.json': JSON.stringify({ name: 'First-time shopper' }),
    '.stuntdouble/checklists/shop.json': JSON.stringify({
      name: 'Shop',
      actor: 'shopper',
      url: `${base}/`,
      instructions: 'Look at the home page.',
      checks: [{ key: 'has-a-heading', description: 'The home page has a heading' }],
    }),
  });
  home = await mkdtemp(join(tmpdir(), 'stuntdouble-home-'));

  studio = spawn(process.execPath, [CLI, 'studio', dir, '--no-open'], {
    env: { ...process.env, STUNTDOUBLE_HOME: home, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  studioPort = await new Promise<number>((ok, fail) => {
    let out = '';
    studio.stdout!.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=\S+/);
      if (match) ok(Number(match[1]));
    });
    studio.on('exit', (code) => fail(new Error(`studio exited ${code}`)));
  });

  client = new Client({ name: 'e2e', version: '0.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [CLI, 'mcp'],
      env: { ...getDefaultEnvironment(), STUNTDOUBLE_PROJECT_DIR: dir },
    })
  );
});

after(async () => {
  await client?.close();
  if (studio?.exitCode === null) studio.kill('SIGTERM');
  site?.close();
  for (const d of [dir, home]) if (d) await rm(d, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client!.callTool({ name, arguments: args })) as CallToolResult;
  return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}

/** Every viewer address in a reply. */
const links = (text: string) => [...text.matchAll(/http:\/\/127\.0\.0\.1:(\d+)\/\S*\?t=\S+/g)];

test(
  'with Studio open, start_run, open_ui and finish_run link Studio and start no viewer',
  { timeout: 90_000 },
  async (t) => {
    if (chromeMissing) return t.skip('No Chrome on this machine');
    const sd = join(dir, '.stuntdouble');
    // Studio recorded itself as soon as it opened on a set-up project.
    assert.ok(await exists(join(sd, '.live', 'studio.json')));

    const started = await call('start_run', { checklist: 'shop' });
    if (/Could not start Chrome/.test(started)) return t.skip('No Chrome on this machine');
    const found = links(started);
    assert.equal(found.length, 1, started);
    assert.equal(Number(found[0]![1]), studioPort, 'the run link is on Studio’s port');
    assert.match(found[0]![0], new RegExp(`:${studioPort}/runs/\\S+-shop\\?t=`));
    assert.equal(await exists(join(sd, '.live', 'server.json')), false, 'no viewer of its own');

    // The link opens Studio's run page, signed in by the key it carries.
    const page = await fetch(found[0]![0], { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.ok(page.headers.get('set-cookie')?.includes(`stuntdouble_${studioPort}=`));

    const opened = await call('open_ui');
    assert.equal(Number(links(opened)[0]![1]), studioPort);
    assert.equal(links(opened).length, 1);

    await call('evaluate_check', {
      check: 'has-a-heading',
      status: 'passed',
      evidence: 'The page has the heading "Mug Shop".',
      locator: { text: 'Mug Shop' },
    });
    const finished = await call('finish_run', { summary: 'Heading found.' });
    assert.deepEqual(
      links(finished).map((m) => Number(m[1])),
      [studioPort]
    );
    assert.equal(await exists(join(sd, '.live', 'server.json')), false);

    // The doctor does not report a second viewer either.
    assert.doesNotMatch(await call('doctor'), /Viewer running on port/);
  }
);

test(
  'when Studio closes, the next link is the MCP server’s own viewer',
  { timeout: 60_000 },
  async (t) => {
    if (chromeMissing) return t.skip('No Chrome on this machine');
    studio.kill('SIGTERM');
    await new Promise((ok) => studio.once('exit', ok));
    const sd = join(dir, '.stuntdouble');
    assert.equal(
      await exists(join(sd, '.live', 'studio.json')),
      false,
      'Studio removes its record on exit'
    );
    const opened = await call('open_ui');
    const found = links(opened);
    assert.equal(found.length, 1, opened);
    // Studio's port is free again, so the new viewer may take it: what matters is that Studio is gone.
    const server = JSON.parse(await readFile(join(sd, '.live', 'server.json'), 'utf8'));
    assert.equal(server.port, Number(found[0]![1]));
    assert.equal(server.pid === studio.pid, false);
    assert.equal(await exists(join(sd, '.live', 'server.json')), true);
  }
);
