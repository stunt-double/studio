// Setting up a project from the Studio, without a model: find the dev server,
// find the routes, draft an actor and checklists from templates, and check the
// files before they are written. It matches what `/stuntdouble setup` does in
// Claude Code. A model-drafted version goes through setup-draft.ts; this module
// makes no model call and starts no process.

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';

import { ActorSchema, ChecklistSchema, ConfigSchema } from './files.ts';

// ── The dev server ──────────────────────────────────────────────────────────

export type DevServer = {
  framework: string | null;
  /** What starts it, e.g. `pnpm dev`; null when nothing says. */
  command: string | null;
  port: number;
  url: string;
  /** Where the port came from: a flag in the script, or the framework's default. */
  source: 'script' | 'default';
};

type Manifest = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  description?: string;
};

const readText = (path: string) => readFile(path, 'utf8').catch(() => null);
export const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  );

async function readManifest(project: string): Promise<Manifest | null> {
  const text = await readText(join(project, 'package.json'));
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Manifest) : null;
  } catch {
    return null;
  }
}

async function packageManager(project: string): Promise<'pnpm' | 'yarn' | 'bun' | 'npm'> {
  if (await exists(join(project, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(join(project, 'yarn.lock'))) return 'yarn';
  if ((await exists(join(project, 'bun.lock'))) || (await exists(join(project, 'bun.lockb'))))
    return 'bun';
  return 'npm';
}

const SCRIPTS = ['dev', 'start', 'preview'] as const;

function scriptCommand(pm: string, script: string): string {
  if (pm === 'pnpm' || pm === 'yarn') return `${pm} ${script}`;
  return script === 'start' && pm === 'npm' ? 'npm start' : `${pm} run ${script}`;
}

/** The port a script asks for: `--port 3001`, `--port=3001`, `-p 3001` or `PORT=3001`. */
export function portFromScript(script: string): number | null {
  const match =
    script.match(/(?:^|\s)(?:--port|-p)(?:=|\s+)(\d{2,5})\b/) ?? script.match(/\bPORT=(\d{2,5})\b/);
  const port = match ? Number(match[1]) : NaN;
  return port > 0 && port < 65536 ? port : null;
}

const JS_FRAMEWORKS: Array<{
  name: string;
  has(deps: Set<string>): boolean;
  port(deps: Set<string>): number;
}> = [
  { name: 'Next.js', has: (d) => d.has('next'), port: () => 3000 },
  { name: 'Astro', has: (d) => d.has('astro'), port: () => 4321 },
  { name: 'SvelteKit', has: (d) => d.has('@sveltejs/kit'), port: () => 5173 },
  {
    name: 'Remix',
    has: (d) => [...d].some((n) => n.startsWith('@remix-run/')),
    // Remix on Vite uses Vite's port; the classic compiler used 3000.
    port: (d) => (d.has('vite') ? 5173 : 3000),
  },
  { name: 'Vite', has: (d) => d.has('vite'), port: () => 5173 },
];

/** Dev servers that are not started from package.json scripts. */
async function otherFramework(
  project: string
): Promise<{ name: string; command: string; port: number } | null> {
  const gemfile = (await readText(join(project, 'Gemfile'))) ?? '';
  if (/gem\s+['"]rails['"]/.test(gemfile) || (await exists(join(project, 'config', 'routes.rb')))) {
    return { name: 'Rails', command: 'bin/rails server', port: 3000 };
  }
  if (await exists(join(project, 'manage.py'))) {
    return { name: 'Django', command: 'python manage.py runserver', port: 8000 };
  }
  if (await exists(join(project, 'artisan'))) {
    return { name: 'Laravel', command: 'php artisan serve', port: 8000 };
  }
  return null;
}

export async function detectDevServer(project: string): Promise<DevServer> {
  const manifest = await readManifest(project);
  const deps = new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ]);
  const js = JS_FRAMEWORKS.find((f) => f.has(deps));
  const other = js ? null : await otherFramework(project);
  const staticSite =
    !js && !other && (await exists(join(project, 'index.html')))
      ? { name: 'Static site', command: 'python3 -m http.server 8000', port: 8000 }
      : null;

  let command: string | null = other?.command ?? staticSite?.command ?? null;
  let flagged: number | null = null;
  const scripts = manifest?.scripts ?? {};
  const script = SCRIPTS.find((s) => typeof scripts[s] === 'string');
  if (script && (js || !other)) {
    command = scriptCommand(await packageManager(project), script);
    flagged = portFromScript(scripts[script]!);
  }
  const framework = js?.name ?? other?.name ?? staticSite?.name ?? null;
  const fallback = js?.port(deps) ?? other?.port ?? staticSite?.port ?? 3000;
  const port = flagged ?? fallback;
  return {
    framework,
    command,
    port,
    url: `http://localhost:${port}`,
    source: flagged ? 'script' : 'default',
  };
}

/** The text of the address, if it is a web address without a login in it. */
export function parseWebUrl(text: string): URL | null {
  const url = URL.parse(text.trim());
  return url && /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
}

export type Probe = { reachable: boolean; status: number | null; message: string };

/**
 * Whether the app answers: one GET to the origin of `address`, no redirects
 * followed, nothing but the status read. Any HTTP answer, a 404 included, means
 * the server is up.
 */
export async function probeDevServer(
  address: string,
  options: { fetch?: typeof fetch; command?: string | null; timeoutMs?: number } = {}
): Promise<Probe> {
  const url = parseWebUrl(address);
  if (!url)
    return { reachable: false, status: null, message: 'Enter a web address, http or https' };
  try {
    const res = await (options.fetch ?? fetch)(url.origin, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 2500),
    });
    await res.body?.cancel().catch(() => {});
    return { reachable: true, status: res.status, message: `${url.origin} is answering.` };
  } catch {
    const start = options.command ? ` Start it with \`${options.command}\`, then check again.` : '';
    return {
      reachable: false,
      status: null,
      message: `Nothing is answering at ${url.origin}.${start}`,
    };
  }
}

// ── Routes and the product ──────────────────────────────────────────────────

export type Route = { path: string; source: string };

const MAX_ROUTES = 60;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.stuntdouble',
  '.venv',
  'venv',
  'vendor',
  'dist',
  'build',
  'coverage',
  'tmp',
  '__pycache__',
]);
const PAGE_EXTENSIONS = /\.(tsx|jsx|ts|js|mjs|mdx|md|astro|vue|svelte|html)$/;

/** Every file under `dir` as a path relative to it, to `depth` folders, skipping build output. */
async function walk(dir: string, depth: number, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || depth <= 0) continue;
      out.push(...(await walk(join(dir, entry.name), depth - 1, rel)));
    } else out.push(rel);
  }
  return out;
}

/** A URL path from folder segments: groups and slots drop out, `[id]` becomes `:id`. */
function toPath(segments: string[]): string | null {
  const parts: string[] = [];
  for (const segment of segments) {
    if (!segment || /^\(.*\)$/.test(segment) || segment.startsWith('@')) continue;
    if (segment.startsWith('_') || segment === 'api') return null;
    const dynamic = segment.match(/^\[\.\.\.(.+)\]$|^\[\[\.\.\.(.+)\]\]$/);
    if (dynamic) parts.push('*');
    else parts.push(segment.replace(/\[([^\]]+)\]/g, ':$1'));
  }
  return '/' + parts.join('/');
}

async function appRouter(project: string): Promise<Route[]> {
  const routes: Route[] = [];
  for (const base of ['app', 'src/app']) {
    for (const file of await walk(join(project, base), 6)) {
      if (!/^page\.(tsx|jsx|ts|js|mdx)$/.test(basename(file))) continue;
      const path = toPath(dirname(file) === '.' ? [] : dirname(file).split('/'));
      if (path) routes.push({ path, source: `${base}/` });
    }
  }
  return routes;
}

async function pagesRouter(project: string): Promise<Route[]> {
  const routes: Route[] = [];
  for (const base of ['pages', 'src/pages']) {
    for (const file of await walk(join(project, base), 5)) {
      if (!PAGE_EXTENSIONS.test(file) || /\.(test|spec|d)\./.test(file) || file.startsWith('api/'))
        continue;
      const segments = file.replace(PAGE_EXTENSIONS, '').split('/');
      if (segments.at(-1) === 'index') segments.pop();
      if (/^(404|500|_app|_document|_error)$/.test(segments.at(-1) ?? '')) continue;
      const path = toPath(segments);
      if (path) routes.push({ path, source: `${base}/` });
    }
  }
  return routes;
}

/** SvelteKit's `src/routes/**\/+page.svelte`, and Remix's flat `app/routes/pricing.tsx`. */
async function routesFolder(project: string): Promise<Route[]> {
  const routes: Route[] = [];
  for (const file of await walk(join(project, 'src', 'routes'), 6)) {
    const m = file.match(/^(.*?)\/?\+page\.\w+$/);
    if (!m) continue;
    const path = toPath(m[1] ? m[1].split('/') : []);
    if (path) routes.push({ path, source: 'src/routes/' });
  }
  for (const file of await walk(join(project, 'app', 'routes'), 1)) {
    if (!PAGE_EXTENSIONS.test(file)) continue;
    const name = file.replace(PAGE_EXTENSIONS, '');
    if (name.startsWith('api.') || name.startsWith('resource.')) continue;
    const parts = name.split(/[./]/).filter((p) => p !== '_index' && p !== 'route');
    // A leading underscore is a layout with no URL segment of its own.
    const path = toPath(
      parts.filter((p) => !p.startsWith('_')).map((p) => p.replace(/^\$(.+)$/, '[$1]'))
    );
    if (path) routes.push({ path, source: 'app/routes/' });
  }
  return routes;
}

const dynamicSegment = (s: string) => s.replace(/<(?:\w+:)?(\w+)>|\{(\w+)\??\}/g, ':$1$2');
const rootPath = (p: string) => '/' + p.replace(/^\/+/, '').replace(/\/+$/, '');

async function railsRoutes(project: string): Promise<Route[]> {
  const text = await readText(join(project, 'config', 'routes.rb'));
  if (!text) return [];
  const routes: Route[] = [];
  const add = (path: string) => routes.push({ path: rootPath(path), source: 'config/routes.rb' });
  if (/^\s*root\b/m.test(text)) add('');
  for (const m of text.matchAll(/^\s*(?:get|match)\s+['"]([^'"]+)['"]/gm)) add(m[1]!);
  for (const m of text.matchAll(/^\s*resources?\s+:(\w+)/gm)) add(m[1]!);
  return routes;
}

async function djangoRoutes(project: string): Promise<Route[]> {
  const routes: Route[] = [];
  for (const file of await walk(project, 2)) {
    if (basename(file) !== 'urls.py') continue;
    const text = (await readText(join(project, file))) ?? '';
    for (const m of text.matchAll(/\bpath\(\s*['"]([^'"]*)['"]/g)) {
      const path = m[1]!;
      if (path.startsWith('admin')) continue;
      routes.push({ path: rootPath(dynamicSegment(path)), source: file });
    }
  }
  return routes;
}

async function laravelRoutes(project: string): Promise<Route[]> {
  const text = await readText(join(project, 'routes', 'web.php'));
  if (!text) return [];
  return [...text.matchAll(/Route::get\(\s*['"]([^'"]*)['"]/g)].map((m) => ({
    path: rootPath(dynamicSegment(m[1]!)),
    source: 'routes/web.php',
  }));
}

/** A folder with an `index.html` is a page; a leading `public/` is the web root, not a segment. */
async function staticRoutes(project: string): Promise<Route[]> {
  const routes: Route[] = [];
  for (const file of await walk(project, 3)) {
    if (basename(file) !== 'index.html') continue;
    const segments = file.split('/').slice(0, -1);
    if (['public', 'static', 'www'].includes(segments[0] ?? '')) segments.shift();
    routes.push({ path: segments.length ? `/${segments.join('/')}/` : '/', source: 'index.html' });
  }
  return routes;
}

/** Pages the project defines, found in its files alone, home first, at most 60. */
export async function discoverRoutes(project: string): Promise<Route[]> {
  const found = (
    await Promise.all([
      appRouter(project),
      pagesRouter(project),
      routesFolder(project),
      railsRoutes(project),
      djangoRoutes(project),
      laravelRoutes(project),
      staticRoutes(project),
    ])
  ).flat();
  const seen = new Set<string>();
  return found
    .filter((r) => !seen.has(r.path) && seen.add(r.path))
    .sort(
      (a, b) =>
        Number(b.path === '/') - Number(a.path === '/') ||
        a.path.split('/').length - b.path.split('/').length ||
        a.path.localeCompare(b.path)
    )
    .slice(0, MAX_ROUTES);
}

export type Product = { name: string | null; description: string | null; readme: string };

const README_CHARS = 3000;

/** What the project says it is: its package name and description, and the start of its README. */
export async function readProduct(project: string): Promise<Product> {
  const manifest = await readManifest(project);
  let readme = '';
  for (const name of ['README.md', 'readme.md', 'README.markdown', 'README']) {
    const text = await readText(join(project, name));
    if (text) {
      readme = text.trim().slice(0, README_CHARS);
      break;
    }
  }
  const heading = readme
    .match(/^#\s+(.+)$/m)?.[1]
    ?.replace(/[*_`]/g, '')
    .trim();
  const pkg = manifest?.name?.replace(/^@[^/]+\//, '');
  return {
    name: heading || pkg || null,
    description: manifest?.description?.trim() || null,
    readme,
  };
}

export type RouteKind = 'home' | 'signup' | 'pricing' | 'checkout' | 'login' | 'other';

export function classifyRoute(path: string): RouteKind {
  if (path === '/') return 'home';
  if (/sign-?up|register|join|get-?started|create-?account|onboard/i.test(path)) return 'signup';
  if (/pric|plans?\b|upgrade|subscribe/i.test(path)) return 'pricing';
  if (/checkout|cart|basket|buy|order|\bpay/i.test(path)) return 'checkout';
  if (/log-?in|sign-?in/i.test(path)) return 'login';
  return 'other';
}

// ── Drafts ──────────────────────────────────────────────────────────────────

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const MIN_CHECKS = 3;
const MAX_CHECKS = 8;
const MIN_CHECKLISTS = 2;
const MAX_CHECKLISTS = 4;

export type Draft = {
  actor: { slug: string } & Record<string, unknown>;
  checklists: Array<{ slug: string } & Record<string, unknown>>;
};

export type Issue = { path: string; message: string };

const DraftShape = z.object({
  actor: z.looseObject({
    slug: z.string().regex(SLUG, 'Use lowercase letters, digits and hyphens'),
  }),
  checklists: z
    .array(
      z.looseObject({ slug: z.string().regex(SLUG, 'Use lowercase letters, digits and hyphens') })
    )
    .min(MIN_CHECKLISTS, `Draft at least ${MIN_CHECKLISTS} checklists`)
    .max(MAX_CHECKLISTS, `Draft at most ${MAX_CHECKLISTS} checklists`),
});

const at = (path: Array<string | number>, prefix: string) =>
  [prefix, ...path].filter((p) => p !== '').join('.');

/**
 * A draft that is safe to preview: every file passes the schema `start_run`
 * reads it with, and the checklists follow the setup rules (3 to 8 pass/fail
 * checks with stable keys and no threshold, addresses on the app under test).
 */
export function parseDraft(
  raw: unknown,
  options: { origin: string }
): { ok: true; draft: Draft } | { ok: false; issues: Issue[] } {
  const shape = DraftShape.safeParse(raw);
  if (!shape.success) {
    return {
      ok: false,
      issues: shape.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const draft = shape.data as Draft;
  const issues: Issue[] = [];
  const { slug: actorSlug, ...actor } = draft.actor;
  const parsedActor = ActorSchema.safeParse(actor);
  if (!parsedActor.success) {
    for (const i of parsedActor.error.issues) {
      issues.push({ path: at(i.path as string[], 'actor'), message: i.message });
    }
  }
  const seen = new Set<string>();
  draft.checklists.forEach((entry, n) => {
    const { slug, ...checklist } = entry;
    const where = `checklists.${n}`;
    if (seen.has(slug))
      issues.push({ path: `${where}.slug`, message: 'Every checklist needs its own slug' });
    seen.add(slug);
    const parsed = ChecklistSchema.safeParse(checklist);
    const found = new Set<string>();
    const add = (path: string, message: string) => {
      if (found.has(path)) return;
      found.add(path);
      issues.push({ path, message });
    };
    if (!parsed.success) {
      for (const i of parsed.error.issues) add(at(i.path as string[], where), i.message);
    }
    // The setup rules read the draft as written, so one retry fixes everything at once.
    if (checklist.actor !== actorSlug) add(`${where}.actor`, `Use the actor ${actorSlug}`);
    const target = typeof checklist.url === 'string' ? URL.parse(checklist.url) : null;
    if (target?.origin !== options.origin) {
      add(`${where}.url`, `Use an address on ${options.origin}`);
    }
    const list = Array.isArray(checklist.checks)
      ? (checklist.checks as Array<Record<string, unknown>>)
      : [];
    if (list.length < MIN_CHECKS || list.length > MAX_CHECKS) {
      add(`${where}.checks`, `Write ${MIN_CHECKS} to ${MAX_CHECKS} checks`);
    }
    list.forEach((check, i) => {
      if ((check.type ?? 'pass_fail') !== 'pass_fail' || check.weight !== undefined) {
        add(`${where}.checks.${i}.type`, 'Use pass/fail checks with no weight');
      }
    });
    if (checklist.pass_threshold !== undefined) {
      add(`${where}.pass_threshold`, 'Leave the pass threshold out');
    }
  });
  return issues.length ? { ok: false, issues } : { ok: true, draft };
}

export type DraftContext = {
  url: string;
  routes: Route[];
  product: Product;
  /** The person's one line on who the user is. */
  description?: string;
};

const urlOf = (origin: string, path: string) => new URL(path, origin).href;

const ACCOUNT_NOTE = {
  kind: 'account',
  title: 'Test accounts only',
  content:
    'Use a test account, such as an address like studio-test@example.com, and never real credentials or a real card. This file is committed.',
};

/** Checklists that need one page of the app, in the order they are offered. */
const KINDS = ['signup', 'checkout', 'pricing'] as const;

const checks = (...list: Array<[string, string]>) =>
  list.map(([key, description]) => ({ key, description }));

/** The deterministic draft: an actor and two to four checklists from the routes found. */
export function templateDraft(context: DraftContext): Draft {
  const origin = new URL(context.url).origin;
  const name = context.product.name ?? 'the product';
  const who = context.description?.trim();
  const needsAccount = context.routes.some((r) =>
    ['signup', 'checkout'].includes(classifyRoute(r.path))
  );
  const actor = {
    slug: 'first-time-visitor',
    name: 'First-time visitor',
    description:
      who ||
      `A person who has never used ${name} before, arrives cold and decides within a minute whether it is worth their time`,
    knowledge: needsAccount ? [ACCOUNT_NOTE] : [],
    persist_login: false,
  };
  const concrete = (kind: string) =>
    context.routes.find((r) => classifyRoute(r.path) === kind && !/[:*]/.test(r.path));
  const checklists: Draft['checklists'] = [
    {
      slug: 'first-look',
      name: 'First look',
      actor: actor.slug,
      url: urlOf(origin, concrete('home')?.path ?? new URL(context.url).pathname),
      instructions:
        'Arrive on the first page as someone who has never heard of the product. Work out what it is, try the main next step without paying or signing up, and follow the main navigation.',
      checks: checks(
        ['says-what-it-is', 'The first screen says plainly what the product is and who it is for'],
        [
          'clear-next-step',
          'There is one clear next step, such as a sign-up button, without scrolling',
        ],
        [
          'navigation-works',
          'Each main navigation link opens a working page, with no error or empty page',
        ],
        ['loads-cleanly', 'The page loads with no error message, broken image or empty section']
      ),
    },
  ];
  const makers: Record<(typeof KINDS)[number], (path: string) => Draft['checklists'][number]> = {
    signup: (path) => ({
      slug: 'sign-up',
      name: 'Sign up',
      actor: actor.slug,
      url: urlOf(origin, path),
      instructions:
        'Find the sign-up form and create an account with a test email address. Stop if the form asks for payment or a real identity document.',
      checks: checks(
        [
          'form-reachable',
          'The sign-up form can be reached from the first page in two clicks or fewer',
        ],
        ['fields-labelled', 'Every field has a visible label that says what to enter'],
        [
          'empty-submit-explains',
          'Submitting the empty form shows a message beside each missing field',
        ],
        [
          'test-account-created',
          'Signing up with a test email address ends on a confirmation or signed-in screen',
        ]
      ),
    }),
    checkout: (path) => ({
      slug: 'checkout',
      name: 'Checkout',
      actor: actor.slug,
      url: urlOf(origin, path),
      instructions:
        'Choose an item, add it to the cart and go through checkout with a test account. Stop before paying: never enter a real card.',
      checks: checks(
        ['add-to-cart', 'Adding an item shows it in the cart straight away'],
        ['cart-total', 'The cart shows the item, the quantity and the total'],
        ['shipping-before-payment', 'The shipping cost is shown before the payment step'],
        ['payment-step-reached', 'The checkout reaches a payment step without an error']
      ),
    }),
    pricing: (path) => ({
      slug: 'pricing',
      name: 'Pricing',
      actor: actor.slug,
      url: urlOf(origin, path),
      instructions:
        'Read the pricing page as someone choosing a plan. Work out what each plan costs and how it differs from the others, then follow each plan button.',
      checks: checks(
        ['plans-priced', 'Each plan shows a price, or says how to get one'],
        ['billing-period', 'The billing period is stated next to every price'],
        ['plans-compared', 'The page says what differs between the plans'],
        ['plan-buttons-work', 'Each plan button opens a page that loads']
      ),
    }),
  };
  for (const kind of KINDS) {
    const route = concrete(kind);
    if (route) checklists.push(makers[kind](route.path));
  }
  if (checklists.length < MIN_CHECKLISTS) {
    checklists.push({
      slug: 'first-look-on-a-phone',
      name: 'First look on a phone',
      actor: actor.slug,
      url: checklists[0]!.url,
      instructions:
        'Arrive on the first page on a phone and work out what the product is. Open the navigation and try the main next step.',
      checks: checks(
        ['no-sideways-scroll', 'The page does not scroll sideways'],
        ['text-readable', 'The text is readable without zooming'],
        ['navigation-reachable', 'The navigation can be opened and each link is easy to tap'],
        ['next-step-visible', 'The main next step is visible without scrolling']
      ),
      browser_config: { preset: 'mobile' },
    });
  }
  return { actor, checklists: checklists.slice(0, MAX_CHECKLISTS) };
}

// ── Files ───────────────────────────────────────────────────────────────────

export type SetupFile = { path: string; content: string };

const json = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;

/** The files setup writes under `.stuntdouble/`, in the order they are shown. */
export function draftFiles(draft: Draft): SetupFile[] {
  const { slug: actorSlug, ...actor } = draft.actor;
  return [
    {
      path: 'stuntdouble.json',
      content: json({
        format: 'stuntdouble/1',
        local_base_url: null,
        headless: false,
        model_screenshots: 'on_request',
        safety: 'third_party',
      }),
    },
    { path: `actors/${actorSlug}.json`, content: json(actor) },
    ...draft.checklists.map(({ slug, ...checklist }) => ({
      path: `checklists/${slug}.json`,
      content: json(checklist),
    })),
    { path: '.gitignore', content: '.live/\n' },
  ];
}

const FILE_PATH =
  /^(stuntdouble\.json|\.gitignore|(?:actors|checklists)\/[a-z0-9][a-z0-9-]*\.json)$/;
const MAX_FILES = 12;
const MAX_FILE_CHARS = 60_000;

/**
 * Whether these are files setup may write, and valid ones. Only the paths
 * above are accepted, so nothing can land outside `.stuntdouble/` or in
 * `runs/` or `.live/`. A file's path names it in the issues, as `files.<path>`.
 */
export function checkSetupFiles(files: SetupFile[], existingActors: ReadonlySet<string>): Issue[] {
  const issues: Issue[] = [];
  const paths = new Set<string>();
  if (files.length === 0 || files.length > MAX_FILES) {
    return [{ path: 'files', message: `Send between 1 and ${MAX_FILES} files` }];
  }
  const actors = new Set(existingActors);
  for (const f of files) {
    if (f.path.startsWith('actors/')) actors.add(basename(f.path, '.json'));
  }
  for (const file of files) {
    const where = `files.${file.path}`;
    if (!FILE_PATH.test(file.path)) {
      issues.push({ path: where, message: 'Studio does not write this file' });
      continue;
    }
    if (paths.has(file.path)) issues.push({ path: where, message: 'This file is listed twice' });
    paths.add(file.path);
    if (file.content.length > MAX_FILE_CHARS) {
      issues.push({ path: where, message: 'This file is too long' });
      continue;
    }
    if (file.path === '.gitignore') {
      if (!file.content.split('\n').some((l) => l.trim() === '.live/')) {
        issues.push({ path: where, message: 'Keep the .live/ line: it holds the viewer key' });
      }
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(file.content);
    } catch (err) {
      issues.push({ path: where, message: `Not valid JSON (${(err as Error).message})` });
      continue;
    }
    const schema =
      file.path === 'stuntdouble.json'
        ? ConfigSchema
        : file.path.startsWith('actors/')
          ? ActorSchema
          : ChecklistSchema;
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        issues.push({ path: where, message: `${i.path.join('.') || 'file'}: ${i.message}` });
      }
    } else if (file.path.startsWith('checklists/')) {
      const actor = (parsed.data as { actor: string }).actor;
      if (!actors.has(actor))
        issues.push({ path: where, message: `There is no actor called ${actor}` });
    }
  }
  if (!paths.has('stuntdouble.json')) {
    issues.push({ path: 'files', message: 'Include stuntdouble.json' });
  }
  return issues;
}
