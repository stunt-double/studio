/**
 * Setting up a project in the Studio, end to end: `stuntdouble studio` on an
 * empty folder, a scripted OpenAI-compatible model as the person's connection,
 * and a real Chrome clicking through the guided setup: the app, the pages
 * found, a model draft, the preview (edited), the write, and the first
 * checklist run to the end. Skipped, saying so, on a machine with no Chrome.
 *
 * The CLI runs from source (Node strips the types), so this needs no build.
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';

import { RunSchema } from '../src/files.ts';
import { fakeModel, type FakeModel, type Step } from './helpers/fake-model.ts';
import { makeProject, pkg } from './helpers/project.ts';

const PKG = fileURLToPath(new URL('..', import.meta.url));

const PAGES: Record<string, string> = {
  '/': `<!doctype html><title>Mug Shop</title>
    <header><h1>Mug Shop</h1><nav><a href="/pricing">Pricing</a></nav></header>
    <main><p>Handmade mugs, posted the same day.</p><a href="/sign-up">Start shopping</a></main>`,
  '/pricing': '<!doctype html><title>Pricing</title><h1>Pricing</h1><p>Mugs from $12</p>',
};

let site: Server;
let base: string;
let model: FakeModel;
let dir: string;
let home: string;
let studio: ChildProcess;
let link: string;
let browser: Browser | undefined;
let chromeMissing = false;

const draft = () => ({
  actor: {
    slug: 'gift-buyer',
    name: 'Gift buyer',
    description: 'Someone who has never bought from a small shop online',
    knowledge: [],
    persist_login: false,
  },
  checklists: [
    {
      slug: 'first-look',
      name: 'First look',
      actor: 'gift-buyer',
      url: `${base}/`,
      instructions: 'Arrive on the home page and work out what the shop sells.',
      checks: [
        { key: 'says-what-it-sells', description: 'The home page says it sells handmade mugs' },
        { key: 'delivery-promise', description: 'The home page promises same-day posting' },
        { key: 'pricing-link', description: 'The header links to a pricing page' },
      ],
    },
    {
      slug: 'pricing',
      name: 'Pricing',
      actor: 'gift-buyer',
      url: `${base}/pricing`,
      instructions: 'Read the prices.',
      checks: [
        { key: 'has-a-price', description: 'A price is shown' },
        { key: 'price-has-currency', description: 'The price has a currency sign' },
        { key: 'heading-matches', description: 'The heading says Pricing' },
      ],
    },
  ],
});

const verdict = (check: string, text: string): Step => ({
  calls: [
    {
      name: 'evaluate_check',
      arguments: {
        check,
        status: 'passed',
        evidence: `The page says "${text}".`,
        locator: { text },
      },
    },
  ],
});

before(async () => {
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    chromeMissing = true;
    return;
  }
  site = createServer((req, res) => {
    const page = PAGES[req.url ?? '/'];
    res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html' }).end(page ?? 'Not found');
  });
  await new Promise<void>((ok) => site.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  // Call 0 drafts the files; the rest are the first run.
  const run: Step[] = [
    { calls: [{ name: 'read_page', arguments: {} }] },
    verdict('says-what-it-sells', 'Handmade mugs'),
    verdict('delivery-promise', 'posted the same day'),
    verdict('pricing-link', 'Pricing'),
    { calls: [{ name: 'finish_run', arguments: { summary: 'The home page explains the shop.' } }] },
  ];
  model = await fakeModel((n) =>
    n === 0 ? { text: JSON.stringify(draft()) } : (run[n - 1] ?? { text: 'Nothing more.' })
  );

  // An empty project: a package.json that says Next.js, the README and two pages, no .stuntdouble/.
  dir = await makeProject({
    'package.json': pkg({
      name: 'mug-shop',
      scripts: { dev: 'next dev' },
      dependencies: { next: '16' },
    }),
    'pnpm-lock.yaml': '',
    'README.md': '# Mug Shop\n\nHandmade mugs for people who give gifts.',
    'app/page.tsx': '',
    'app/pricing/page.tsx': '',
  });
  home = await mkdtemp(join(tmpdir(), 'stuntdouble-home-'));
  await writeFile(
    join(home, 'credentials.json'),
    JSON.stringify({ connection: { provider: 'openai', model: 'scripted', base_url: model.url } }),
    { mode: 0o600 }
  );
  studio = spawn(process.execPath, [join(PKG, 'src', 'cli.ts'), 'studio', dir, '--no-open'], {
    env: { ...process.env, STUNTDOUBLE_HOME: home, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  link = await new Promise<string>((ok, fail) => {
    let out = '';
    studio.stdout!.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/http:\/\/127\.0\.0\.1:\d+\/\?t=\S+/);
      if (match) ok(match[0]);
    });
    studio.on('exit', (code) => fail(new Error(`studio exited ${code}`)));
  });
});

after(async () => {
  await browser?.close();
  studio?.kill('SIGTERM');
  await new Promise((ok) => setTimeout(ok, 300));
  site?.close();
  await model?.close();
  for (const d of [dir, home]) if (d) await rm(d, { recursive: true, force: true });
});

test('studio setup: the guided flow on an empty project, then the first checklist runs', async (t) => {
  if (chromeMissing) return t.skip('No Chrome on this machine');
  const page = await browser!.newPage({ viewport: { width: 1100, height: 900 } });
  try {
    await page.goto(link);
    await page.getByRole('heading', { name: 'Set up ' }).waitFor();

    // 1. The app: found from package.json, and edited to the fixture site.
    const step = (name: string) =>
      page.locator('.step[data-state="current"]').filter({ hasText: name });
    await step('Your app').waitFor();
    assert.match(
      await page.locator('.facts-line').innerText(),
      /Next\.js, pnpm dev, http:\/\/localhost:3000/
    );
    // Nothing runs on 3000 in this test: the page says so and names the command.
    await page.getByText(/Nothing is answering at http:\/\/localhost:3000/).waitFor();
    assert.match(await page.locator('.probe').innerText(), /Start it with `pnpm dev`/);
    await page.getByLabel('Address to test').fill(base);
    await page.getByRole('button', { name: 'Check it' }).click();
    await page.getByText(`${base} is answering.`).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();

    // 2. The pages found.
    await step('What Studio found').waitFor();
    assert.deepEqual(await page.locator('.routes code').allInnerTexts(), ['/', '/pricing']);
    await page
      .getByLabel('Who is the user?')
      .fill('Someone who has never bought from a small shop online');
    await page.getByRole('button', { name: 'Continue' }).click();

    // 3. The model draft, on the scripted connection.
    await step('Draft').waitFor();
    await page.getByRole('button', { name: 'Draft with scripted' }).click();

    // 4. The preview: nothing written yet; the person makes the run headless.
    await step('Preview').waitFor();
    assert.equal(
      await stat(join(dir, '.stuntdouble')).then(
        () => true,
        () => false
      ),
      false
    );
    assert.match(
      await page.locator('.step-body').innerText(),
      /Drafted with scripted: 1 call, 1,050 tokens/
    );
    const files = await page
      .locator('.setup-file textarea')
      .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).name));
    assert.deepEqual(files, [
      'stuntdouble.json',
      'actors/gift-buyer.json',
      'checklists/first-look.json',
      'checklists/pricing.json',
      '.gitignore',
    ]);
    // A broken edit is refused beside its own file, and nothing is written.
    await page.locator('textarea[name="checklists/pricing.json"]').fill('{ nope');
    await page.getByRole('button', { name: 'Write 5 files' }).click();
    await page.getByText(/Not valid JSON/).waitFor();
    assert.equal(
      await stat(join(dir, '.stuntdouble', 'stuntdouble.json')).then(
        () => true,
        () => false
      ),
      false
    );
    await page
      .locator('textarea[name="checklists/pricing.json"]')
      .fill(JSON.stringify(draft().checklists[1]!, null, 2).replace('"slug": "pricing",', ''));
    const config = page.locator('textarea[name="stuntdouble.json"]');
    await config.fill((await config.inputValue()).replace('"headless": false', '"headless": true'));
    await page.getByText('Two lines for Claude Code').click();
    await page.getByRole('button', { name: 'Write 5 files' }).click();

    // 5. Written; the first run, locally.
    await step('First run').waitFor();
    const sd = join(dir, '.stuntdouble');
    assert.deepEqual((await readdir(join(sd, 'checklists'))).sort(), [
      'first-look.json',
      'pricing.json',
    ]);
    assert.equal(await readFile(join(sd, '.gitignore'), 'utf8'), '.live/\n');
    assert.equal(JSON.parse(await readFile(join(sd, 'stuntdouble.json'), 'utf8')).headless, true);
    // Studio leaves the agent's files alone.
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
    assert.match(
      (await page.locator('.snippet pre').first().textContent()) ?? '',
      /## Stunt Double/
    );
    await page.getByRole('button', { name: 'Run locally' }).click();
    await page.waitForURL(/\/runs\//);

    // The run finishes on the scripted model, and the page shows its verdicts.
    let runDir = '';
    for (let i = 0; i < 120 && !runDir; i++) {
      const runs = await readdir(join(sd, 'runs')).catch(() => []);
      runDir = runs.find((r) => r.endsWith('-first-look')) ?? '';
      if (!runDir) await new Promise((ok) => setTimeout(ok, 250));
    }
    assert.ok(runDir, 'a first-look run started');
    let run;
    for (let i = 0; i < 120; i++) {
      run = RunSchema.parse(
        JSON.parse(await readFile(join(sd, 'runs', runDir, 'run.json'), 'utf8'))
      );
      if (run.status !== 'running') break;
      await new Promise((ok) => setTimeout(ok, 500));
    }
    assert.equal(run!.status, 'completed');
    assert.deepEqual(run!.runner.model, { provider: 'openai', id: 'scripted' });
    assert.deepEqual(Object.fromEntries(run!.results.map((r) => [r.check, r.status])), {
      'says-what-it-sells': 'passed',
      'delivery-promise': 'passed',
      'pricing-link': 'passed',
    });
    assert.equal(run!.score?.outcome, 'passed');
    // One call drafted the files, six ran them.
    assert.equal(model.requests.length, 6);
    await page.getByText('The home page explains the shop.').waitFor();
  } finally {
    await page.close();
  }
});

test('studio setup: files written by a coding agent are picked up while the setup is open', async (t) => {
  if (chromeMissing) return t.skip('No Chrome on this machine');
  const project = await makeProject({
    'package.json': pkg({
      name: 'other',
      scripts: { dev: 'vite' },
      devDependencies: { vite: '7' },
    }),
    'index.html': '<h1>Hi</h1>',
  });
  const agent = spawn(
    process.execPath,
    [join(PKG, 'src', 'cli.ts'), 'studio', project, '--no-open'],
    {
      env: { ...process.env, STUNTDOUBLE_HOME: home, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const page = await browser!.newPage();
  try {
    const url = await new Promise<string>((ok, fail) => {
      let out = '';
      agent.stdout!.on('data', (chunk) => {
        out += chunk;
        const match = out.match(/http:\/\/127\.0\.0\.1:\d+\/\?t=\S+/);
        if (match) ok(match[0]);
      });
      agent.on('exit', (code) => fail(new Error(`studio exited ${code}`)));
    });
    await page.goto(url);
    await page.getByText('Vite, npm run dev').waitFor();
    // The paste-in prompts are there.
    await page.getByText('Set up with Claude Code or Codex instead').click();
    await page.getByText('/stuntdouble setup', { exact: true }).waitFor();

    // The agent writes the files; the open page leaves the setup by itself.
    const sd = join(project, '.stuntdouble');
    await mkdir(join(sd, 'actors'), { recursive: true });
    await mkdir(join(sd, 'checklists'), { recursive: true });
    await writeFile(join(sd, 'actors', 'shopper.json'), JSON.stringify({ name: 'Shopper' }));
    await writeFile(
      join(sd, 'checklists', 'home.json'),
      JSON.stringify({
        name: 'Home',
        actor: 'shopper',
        url: 'http://localhost:5173/',
        instructions: 'Look at the home page.',
        checks: [{ key: 'has-heading', description: 'There is a heading' }],
      })
    );
    await writeFile(join(sd, 'stuntdouble.json'), JSON.stringify({ format: 'stuntdouble/1' }));
    await page.getByText('No runs yet').waitFor();
    assert.equal(await page.locator('.steps').count(), 0);
  } finally {
    await page.close();
    agent.kill('SIGTERM');
    await rm(project, { recursive: true, force: true });
  }
});
