/**
 * Setup without a model: the dev server and port for each framework, the
 * routes found in the project's files, the template drafts, the draft rules and
 * the checks on the files before they are written.
 */

import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';

import { ActorSchema, ChecklistSchema } from '../src/files.ts';
import {
  checkSetupFiles,
  classifyRoute,
  detectDevServer,
  discoverRoutes,
  draftFiles,
  parseDraft,
  portFromScript,
  probeDevServer,
  readProduct,
  templateDraft,
} from '../src/setup.ts';
import { makeProject, pkg } from './helpers/project.ts';

async function detect(files: Record<string, string>) {
  const dir = await makeProject(files);
  try {
    return await detectDevServer(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('dev server and port: each framework, from its dependency and its default port', async () => {
  const dev = { scripts: { dev: 'x' } };
  const cases: Array<[string, Record<string, string>, string, number]> = [
    ['Next.js', { 'package.json': pkg({ ...dev, dependencies: { next: '16' } }) }, 'Next.js', 3000],
    ['Vite', { 'package.json': pkg({ ...dev, devDependencies: { vite: '7' } }) }, 'Vite', 5173],
    ['Astro', { 'package.json': pkg({ ...dev, dependencies: { astro: '5' } }) }, 'Astro', 4321],
    [
      'SvelteKit',
      { 'package.json': pkg({ ...dev, devDependencies: { '@sveltejs/kit': '2', vite: '7' } }) },
      'SvelteKit',
      5173,
    ],
    [
      'Remix on the classic compiler',
      { 'package.json': pkg({ ...dev, dependencies: { '@remix-run/react': '2' } }) },
      'Remix',
      3000,
    ],
    [
      'Remix on Vite',
      {
        'package.json': pkg({
          ...dev,
          dependencies: { '@remix-run/react': '2' },
          devDependencies: { vite: '7' },
        }),
      },
      'Remix',
      5173,
    ],
    [
      'Rails',
      { Gemfile: "source 'x'\ngem 'rails', '~> 8'\n", 'config/routes.rb': '' },
      'Rails',
      3000,
    ],
    ['Django', { 'manage.py': '#!/usr/bin/env python' }, 'Django', 8000],
    ['Laravel', { artisan: '#!/usr/bin/env php' }, 'Laravel', 8000],
  ];
  for (const [label, files, framework, port] of cases) {
    const found = await detect(files);
    assert.equal(found.framework, framework, label);
    assert.equal(found.port, port, label);
    assert.equal(found.url, `http://localhost:${port}`, label);
    assert.equal(found.source, 'default', label);
  }
});

test('dev server: the command comes from the dev, start or preview script and the lockfile', async () => {
  const next = { dependencies: { next: '16' } };
  const pnpm = await detect({
    'package.json': pkg({ ...next, scripts: { dev: 'next dev', start: 'next start' } }),
    'pnpm-lock.yaml': '',
  });
  assert.equal(pnpm.command, 'pnpm dev');
  const yarn = await detect({
    'package.json': pkg({ ...next, scripts: { start: 'next start' } }),
    'yarn.lock': '',
  });
  assert.equal(yarn.command, 'yarn start');
  const npm = await detect({ 'package.json': pkg({ ...next, scripts: { dev: 'next dev' } }) });
  assert.equal(npm.command, 'npm run dev');
  const npmStart = await detect({ 'package.json': pkg({ ...next, scripts: { start: 'x' } }) });
  assert.equal(npmStart.command, 'npm start');
  const bun = await detect({
    'package.json': pkg({ ...next, scripts: { preview: 'next start' } }),
    'bun.lock': '',
  });
  assert.equal(bun.command, 'bun run preview');
  // A project with no scripts still gets the framework's port.
  assert.equal((await detect({ 'package.json': pkg(next) })).command, null);
  // Rails and the like start from their own command.
  assert.equal(
    (await detect({ Gemfile: "gem 'rails'", 'config/routes.rb': '' })).command,
    'bin/rails server'
  );
});

test('dev server: a port flag in the script wins over the default', async () => {
  const found = await detect({
    'package.json': pkg({ dependencies: { next: '16' }, scripts: { dev: 'next dev -p 3100' } }),
    'pnpm-lock.yaml': '',
  });
  assert.deepEqual(
    { port: found.port, url: found.url, source: found.source, command: found.command },
    { port: 3100, url: 'http://localhost:3100', source: 'script', command: 'pnpm dev' }
  );
  assert.equal(portFromScript('vite --port 4000'), 4000);
  assert.equal(portFromScript('vite --port=4001 --host'), 4001);
  assert.equal(portFromScript('PORT=8080 node server.js'), 8080);
  assert.equal(portFromScript('astro dev --port 4400'), 4400);
  assert.equal(portFromScript('tsc -p tsconfig.json'), null);
  assert.equal(portFromScript('next dev'), null);
  assert.equal(portFromScript('next dev -p 99999'), null);
});

test('dev server: a static site, and a folder that says nothing', async () => {
  const site = await detect({ 'index.html': '<h1>Hi</h1>' });
  assert.deepEqual([site.framework, site.port], ['Static site', 8000]);
  const unknown = await detect({ 'notes.txt': 'hello' });
  assert.deepEqual([unknown.framework, unknown.command, unknown.port], [null, null, 3000]);
});

test('probe: an answer of any status means the server is up, and nothing means it is not', async () => {
  const seen: string[] = [];
  const up = await probeDevServer('http://localhost:3000/some/page?x=1', {
    fetch: (async (url: string) => {
      seen.push(String(url));
      return new Response('Not found', { status: 404 });
    }) as unknown as typeof fetch,
  });
  assert.equal(up.reachable, true);
  assert.equal(up.status, 404);
  // Only the origin is asked, never the path the person typed.
  assert.deepEqual(seen, ['http://localhost:3000']);

  const down = await probeDevServer('http://localhost:3000', {
    command: 'pnpm dev',
    fetch: (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch,
  });
  assert.equal(down.reachable, false);
  assert.match(down.message, /Nothing is answering at http:\/\/localhost:3000/);
  assert.match(down.message, /Start it with `pnpm dev`/);

  for (const bad of ['', 'ftp://x', 'not a url', 'http://user:pw@localhost:3000']) {
    const refused = await probeDevServer(bad, {
      fetch: (async () => assert.fail('no request')) as unknown as typeof fetch,
    });
    assert.equal(refused.reachable, false, bad);
  }
});

async function routesOf(files: Record<string, string>) {
  const dir = await makeProject(files);
  try {
    return (await discoverRoutes(dir)).map((r) => r.path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('routes: the Next.js app router, with groups, slots and dynamic segments', async () => {
  const paths = await routesOf({
    'app/page.tsx': '',
    'app/pricing/page.tsx': '',
    'app/(marketing)/about/page.mdx': '',
    'app/blog/[slug]/page.tsx': '',
    'app/docs/[...path]/page.tsx': '',
    'app/@modal/login/page.tsx': '',
    'app/api/health/route.ts': '',
    'app/_private/page.tsx': '',
    'src/app/dashboard/page.tsx': '',
    'node_modules/pkg/app/page.tsx': '',
  });
  assert.deepEqual(paths, [
    '/',
    '/about',
    '/dashboard',
    '/login',
    '/pricing',
    '/blog/:slug',
    '/docs/*',
  ]);
});

test('routes: the pages folder, SvelteKit and Remix', async () => {
  assert.deepEqual(
    await routesOf({
      'pages/index.tsx': '',
      'pages/_app.tsx': '',
      'pages/404.tsx': '',
      'pages/api/x.ts': '',
      'pages/sign-up.tsx': '',
      'src/pages/about.astro': '',
      'src/pages/blog/index.md': '',
      'src/pages/blog/[id].astro': '',
    }),
    ['/', '/about', '/blog', '/sign-up', '/blog/:id']
  );
  assert.deepEqual(
    await routesOf({
      'src/routes/+page.svelte': '',
      'src/routes/+layout.svelte': '',
      'src/routes/pricing/+page.svelte': '',
      'src/routes/(app)/settings/+page.svelte': '',
      'src/routes/post/[id]/+page.svelte': '',
    }),
    ['/', '/pricing', '/settings', '/post/:id']
  );
  assert.deepEqual(
    await routesOf({
      'app/routes/_index.tsx': '',
      'app/routes/pricing.tsx': '',
      'app/routes/blog.$slug.tsx': '',
      'app/routes/_auth.login.tsx': '',
      'app/routes/api.hook.ts': '',
    }),
    ['/', '/login', '/pricing', '/blog/:slug']
  );
});

test('routes: Rails, Django and Laravel route files', async () => {
  assert.deepEqual(
    await routesOf({
      'config/routes.rb': `Rails.application.routes.draw do
  root 'home#index'
  get '/pricing', to: 'pages#pricing'
  get "signup", to: "users#new"
  resources :products
  resource :cart
  post '/hook', to: 'x#y'
end`,
    }),
    ['/', '/cart', '/pricing', '/products', '/signup']
  );
  assert.deepEqual(
    await routesOf({
      'shop/urls.py': `urlpatterns = [
    path('', views.home, name='home'),
    path('pricing/', views.pricing),
    path('product/<int:pk>/', views.product),
    path('admin/', admin.site.urls),
]`,
    }),
    ['/', '/pricing', '/product/:pk']
  );
  assert.deepEqual(
    await routesOf({
      'routes/web.php': `Route::get('/', fn () => view('home'));
Route::get('/register', [A::class, 'b']);
Route::get('/orders/{id}', [A::class, 'c']);
Route::post('/x', [A::class, 'd']);`,
    }),
    ['/', '/register', '/orders/:id']
  );
});

test('routes: static folders with an index.html, and nothing at all', async () => {
  assert.deepEqual(
    await routesOf({
      'index.html': '',
      'pricing/index.html': '',
      'public/docs/index.html': '',
      'dist/index.html': '',
      'a/b/c/d/e/index.html': '',
    }),
    ['/', '/docs/', '/pricing/']
  );
  assert.deepEqual(await routesOf({ 'README.md': '# Hi' }), []);
});

test('routes: capped at 60, home first', async () => {
  const files: Record<string, string> = { 'app/page.tsx': '' };
  for (let n = 0; n < 80; n++) files[`app/p${String(n).padStart(2, '0')}/page.tsx`] = '';
  const paths = await routesOf(files);
  assert.equal(paths.length, 60);
  assert.equal(paths[0], '/');
});

test('product: the README heading, the package description and a trimmed README', async () => {
  const dir = await makeProject({
    'package.json': pkg({ name: '@acme/mug-shop', description: 'Mugs, sold online' }),
    'README.md': `# Mug Shop\n\n${'For people who love mugs. '.repeat(400)}`,
  });
  const product = await readProduct(dir);
  assert.equal(product.name, 'Mug Shop');
  assert.equal(product.description, 'Mugs, sold online');
  assert.equal(product.readme.length, 3000);
  const bare = await readProduct(await makeProject({ 'package.json': pkg({ name: '@acme/web' }) }));
  assert.deepEqual([bare.name, bare.readme], ['web', '']);
});

test('classifyRoute names the flows the templates cover', () => {
  const kinds = Object.fromEntries(
    [
      '/',
      '/sign-up',
      '/register',
      '/pricing',
      '/plans',
      '/checkout',
      '/cart',
      '/login',
      '/blog',
    ].map((p) => [p, classifyRoute(p)])
  );
  assert.deepEqual(kinds, {
    '/': 'home',
    '/sign-up': 'signup',
    '/register': 'signup',
    '/pricing': 'pricing',
    '/plans': 'pricing',
    '/checkout': 'checkout',
    '/cart': 'checkout',
    '/login': 'login',
    '/blog': 'other',
  });
});

const context = (paths: string[], extra: { description?: string; name?: string } = {}) => ({
  url: 'http://localhost:3000',
  routes: paths.map((path) => ({ path, source: 'app/' })),
  product: { name: extra.name ?? 'Mug Shop', description: null, readme: '' },
  description: extra.description,
});

test('templates: a checklist per flow found, 2 to 4, each valid and by the setup rules', () => {
  const full = templateDraft(context(['/', '/sign-up', '/pricing', '/checkout', '/blog/:slug']));
  assert.deepEqual(
    full.checklists.map((c) => c.slug),
    ['first-look', 'sign-up', 'checkout', 'pricing']
  );
  const sparse = templateDraft(context(['/']));
  assert.deepEqual(
    sparse.checklists.map((c) => c.slug),
    ['first-look', 'first-look-on-a-phone']
  );
  assert.deepEqual(sparse.checklists[1]!.browser_config, {
    preset: 'mobile',
  });
  for (const draft of [full, sparse, templateDraft(context([]))]) {
    const parsed = parseDraft(draft, { origin: 'http://localhost:3000' });
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.ok(draft.checklists.length >= 2 && draft.checklists.length <= 4);
    for (const c of draft.checklists) {
      const { slug: _slug, ...file } = c;
      const checklist = ChecklistSchema.parse(file);
      assert.ok(checklist.checks.length >= 3 && checklist.checks.length <= 8, c.slug);
      assert.ok(checklist.checks.every((k) => k.type === 'pass_fail'));
      assert.equal(checklist.pass_threshold, undefined);
    }
  }
});

test('templates: the actor is a role, test accounts only, and takes the one-line description', () => {
  const draft = templateDraft(
    context(['/', '/sign-up'], { description: 'Runs a small shop and has never used the product' })
  );
  const { slug, ...actor } = draft.actor;
  assert.equal(slug, 'first-time-visitor');
  const parsed = ActorSchema.parse(actor);
  assert.equal(parsed.name, 'First-time visitor');
  assert.equal(parsed.description, 'Runs a small shop and has never used the product');
  assert.match(parsed.knowledge[0]!.content, /never real credentials/);
  // Nothing to sign up or pay with: no account note.
  assert.deepEqual(templateDraft(context(['/'])).actor.knowledge, []);
  // Dynamic routes are not checklist addresses.
  assert.equal(
    templateDraft(context(['/', '/checkout/:id'])).checklists.some((c) => c.slug === 'checkout'),
    false
  );
  // The house style for copy: no long dashes, and no past-tense verb for what an actor does.
  assert.doesNotMatch(
    JSON.stringify(draftFiles(templateDraft(context(['/', '/sign-up'])))),
    new RegExp('\\u2014|walk' + 'ed')
  );
});

test('the files: config first, then the actor and checklists, and the .gitignore line', () => {
  const files = draftFiles(templateDraft(context(['/', '/pricing'])));
  assert.deepEqual(
    files.map((f) => f.path),
    [
      'stuntdouble.json',
      'actors/first-time-visitor.json',
      'checklists/first-look.json',
      'checklists/pricing.json',
      '.gitignore',
    ]
  );
  assert.equal(files.at(-1)!.content, '.live/\n');
  assert.deepEqual(checkSetupFiles(files, new Set()), []);
});

test('draft rules: what a model draft must satisfy', () => {
  const good = templateDraft(context(['/', '/pricing']));
  const origin = 'http://localhost:3000';
  const issues = (mutate: (d: ReturnType<typeof templateDraft>) => void) => {
    const draft = structuredClone(good);
    mutate(draft);
    const parsed = parseDraft(draft, { origin });
    assert.equal(parsed.ok, false);
    return parsed.ok ? [] : parsed.issues.map((i) => i.path);
  };
  assert.deepEqual(parseDraft('nope', { origin }).ok, false);
  assert.ok(issues((d) => (d.checklists.length = 1)).includes('checklists'));
  assert.ok(
    issues((d) => (d.checklists[0]!.checks = [{ key: 'a', description: 'b' }])).includes(
      'checklists.0.checks'
    )
  );
  assert.ok(
    issues((d) => {
      (d.checklists[0]!.checks as Array<Record<string, unknown>>)[0]!.type = 'weighted';
    }).includes('checklists.0.checks.0.type')
  );
  assert.ok(
    issues((d) => (d.checklists[0]!.pass_threshold = 80)).includes('checklists.0.pass_threshold')
  );
  assert.ok(
    issues((d) => (d.checklists[0]!.url = 'https://elsewhere.example/')).includes(
      'checklists.0.url'
    )
  );
  assert.ok(
    issues((d) => (d.checklists[0]!.actor = 'someone-else')).includes('checklists.0.actor')
  );
  assert.ok(issues((d) => (d.checklists[1]!.slug = 'first-look')).includes('checklists.1.slug'));
  assert.ok(issues((d) => (d.actor.slug = 'Not A Slug')).includes('actor.slug'));
  assert.ok(issues((d) => delete d.actor.name).includes('actor.name'));
  assert.ok(
    issues((d) => {
      (d.checklists[0]!.checks as Array<{ key: string }>)[0]!.key = 'Bad Key';
    }).includes('checklists.0.checks.0.key')
  );
});

test('file checks: only setup paths, valid files, an actor for every checklist', () => {
  const files = draftFiles(templateDraft(context(['/', '/pricing'])));
  const paths = (list: Parameters<typeof checkSetupFiles>[0], actors = new Set<string>()) =>
    checkSetupFiles(list, actors).map((i) => i.path);

  for (const path of [
    '../outside.json',
    'runs/x/run.json',
    '.live/server.json',
    'actors/../../x.json',
    'actors/Upper.json',
    'checklists/a/b.json',
    '/etc/passwd',
    'hooks.json',
    'CLAUDE.md',
    '.claude/settings.json',
  ]) {
    assert.deepEqual(paths([...files, { path, content: '{}' }]), [`files.${path}`], path);
  }
  assert.deepEqual(paths([...files, files[0]!]), ['files.stuntdouble.json']);
  assert.deepEqual(paths(files.filter((f) => f.path !== 'stuntdouble.json')), ['files']);
  assert.deepEqual(paths([]), ['files']);

  const broken = files.map((f) =>
    f.path === 'checklists/pricing.json' ? { ...f, content: '{' } : f
  );
  assert.deepEqual(paths(broken), ['files.checklists/pricing.json']);
  const wrongKey = files.map((f) =>
    f.path === 'actors/first-time-visitor.json' ? { ...f, content: '{"name":"","extra":1}' } : f
  );
  assert.deepEqual(new Set(paths(wrongKey)), new Set(['files.actors/first-time-visitor.json']));
  // A checklist needs its actor: in the batch or already on disk.
  const noActor = files.filter((f) => !f.path.startsWith('actors/'));
  assert.deepEqual(
    new Set(paths(noActor)),
    new Set(['files.checklists/first-look.json', 'files.checklists/pricing.json'])
  );
  assert.deepEqual(paths(noActor, new Set(['first-time-visitor'])), []);
  // The viewer key lives under .live/: the line stays.
  const ignore = files.map((f) =>
    f.path === '.gitignore' ? { ...f, content: 'node_modules\n' } : f
  );
  assert.deepEqual(paths(ignore), ['files..gitignore']);
});
