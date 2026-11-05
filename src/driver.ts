// A `BrowserDriver` over Playwright, adapted from the browser toolset's example
// (`packages/browser-toolset/examples/src/playwright-driver.ts`), as its header
// invites. The changes: playwright-core instead of playwright, a persistent
// context on a profile directory, so a run gets the person's own Chrome with a
// fresh profile (or the actor's kept one), never their everyday profile, and the
// run's rule on private addresses applied to every navigation, not only the
// navigate tool's.

import type {
  BrowserDriver,
  DriverActResult,
  DriverContext,
  DriverDomainPolicy,
  DriverLoadState,
  DriverLocator,
  DriverNavigateOptions,
  DriverPage,
  DriverScreenshotOptions,
  DriverWaitForSelectorOptions,
} from '@stuntkit/browser-toolset/driver';
import { hostMatchesDomain } from '@stuntkit/browser-toolset/safety';
import {
  chromium,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Request,
} from 'playwright-core';

/**
 * Time the browser spent waiting on the page during a step: a navigation (goto,
 * back, forward) or a load state. Fixed pauses (`waitForTimeout`, the toolset's
 * settle delay and the `wait` tool) are not counted: they are the same length
 * whatever the product does.
 */
export type PageWait = { kind: 'navigation' | 'load'; ms: number };

/** Collects the waits since the last `take`, shared by every tab of one browser. */
class WaitLog {
  private waits: PageWait[] = [];

  async time<T>(kind: PageWait['kind'], work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await work();
    } finally {
      this.waits.push({ kind, ms: Math.round(performance.now() - started) });
    }
  }

  take(): PageWait[] {
    const waits = this.waits;
    this.waits = [];
    return waits;
  }
}

/** A step's thumbnail: about this wide, in CSS pixels, as a JPEG. */
const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_QUALITY = 60;
const cdpSessions = new WeakMap<Page, Promise<CDPSession>>();

/** Playwright's `Page` objects are stable, so a WeakMap gives each tab a lasting id. */
const pageIds = new WeakMap<Page, string>();
let pageSeq = 0;

function idOf(page: Page): string {
  let id = pageIds.get(page);
  if (!id) {
    pageSeq += 1;
    id = `pw-${pageSeq}`;
    pageIds.set(page, id);
  }
  return id;
}

class PlaywrightPage implements DriverPage {
  readonly id: string;
  readonly raw: Page;
  private readonly waits: WaitLog;

  constructor(page: Page, waits: WaitLog) {
    this.raw = page;
    this.id = idOf(page);
    this.waits = waits;
  }

  goto(url: string, options: DriverNavigateOptions = {}) {
    return this.waits.time('navigation', () =>
      this.raw.goto(url, {
        ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
        ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
      })
    );
  }
  goBack() {
    return this.waits.time('navigation', () => this.raw.goBack());
  }
  goForward() {
    return this.waits.time('navigation', () => this.raw.goForward());
  }
  screenshot(options: DriverScreenshotOptions = {}): Promise<Buffer> {
    return this.raw.screenshot(options);
  }
  evaluate<R = unknown, Arg = unknown>(
    expression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg
  ): Promise<R> {
    if (typeof expression === 'string') return this.raw.evaluate(expression) as Promise<R>;
    return this.raw.evaluate(expression as (arg: unknown) => R | Promise<R>, arg) as Promise<R>;
  }
  url() {
    return this.raw.url();
  }
  title() {
    return this.raw.title();
  }
  setViewportSize(width: number, height: number) {
    return this.raw.setViewportSize({ width, height });
  }
  waitForTimeout(ms: number) {
    return this.raw.waitForTimeout(ms);
  }
  waitForSelector(selector: string, options: DriverWaitForSelectorOptions = {}) {
    return this.raw.waitForSelector(selector, options);
  }
  waitForLoadState(state: DriverLoadState, timeoutMs?: number) {
    return this.waits.time('load', () =>
      this.raw.waitForLoadState(state, timeoutMs ? { timeout: timeoutMs } : undefined)
    );
  }
  locator(selector: string): DriverLocator {
    return this.raw.locator(selector).first();
  }
  click(x: number, y: number, options: Parameters<DriverPage['click']>[2] = {}) {
    return this.raw.mouse.click(x, y, options);
  }
  hover(x: number, y: number) {
    return this.raw.mouse.move(x, y);
  }
  async scroll(x: number, y: number, deltaX: number, deltaY: number) {
    await this.raw.mouse.move(x, y);
    await this.raw.mouse.wheel(deltaX, deltaY);
  }
  async dragAndDrop(fromX: number, fromY: number, toX: number, toY: number) {
    await this.raw.mouse.move(fromX, fromY);
    await this.raw.mouse.down();
    await this.raw.mouse.move(toX, toY, { steps: 10 });
    await this.raw.mouse.up();
  }
  type(text: string) {
    return this.raw.keyboard.type(text);
  }
  keyPress(key: string) {
    return this.raw.keyboard.press(key);
  }
  close() {
    return this.raw.close();
  }
}

class PlaywrightContext implements DriverContext {
  private readonly context: BrowserContext;
  readonly waits = new WaitLog();
  private active: Page | undefined;
  private policy: DriverDomainPolicy = {};
  private routed = false;

  constructor(context: BrowserContext) {
    this.context = context;
    // Popups and `target="_blank"` links become the active tab, as in a browser.
    context.on('page', (page) => {
      this.active = page;
    });
  }

  activePage(): PlaywrightPage | undefined {
    const open = this.context.pages();
    if (!this.active || this.active.isClosed()) this.active = open[open.length - 1];
    return this.active ? new PlaywrightPage(this.active, this.waits) : undefined;
  }
  pages(): DriverPage[] {
    return this.context.pages().map((p) => new PlaywrightPage(p, this.waits));
  }
  async newPage(url?: string): Promise<DriverPage> {
    const page = await this.context.newPage();
    this.active = page;
    if (url) await this.waits.time('navigation', () => page.goto(url));
    return new PlaywrightPage(page, this.waits);
  }
  async setActivePage(page: DriverPage): Promise<void> {
    const raw = this.context.pages().find((p) => idOf(p) === page.id);
    if (!raw) throw new Error(`No open tab with id ${page.id}`);
    this.active = raw;
    await raw.bringToFront();
  }
  clearCookies() {
    return this.context.clearCookies();
  }
  async addInitScript(source: string): Promise<void> {
    await this.context.addInitScript(source);
  }
  /** Abort requests to blocked hosts, or to anything outside the allow list. */
  async setDomainPolicy(policy: DriverDomainPolicy): Promise<void> {
    this.policy = policy;
    if (this.routed) return;
    this.routed = true;
    await this.context.route('**/*', (route) => {
      let host = '';
      try {
        host = new URL(route.request().url()).hostname;
      } catch {
        return route.continue();
      }
      const { allowedDomains, blockedDomains } = this.policy;
      const blocked =
        (blockedDomains ?? []).some((d) => hostMatchesDomain(host, d)) ||
        (allowedDomains !== undefined &&
          allowedDomains.length > 0 &&
          !allowedDomains.some((d) => hostMatchesDomain(host, d)));
      return blocked ? route.abort('blockedbyclient') : route.continue();
    });
  }
}

export type LaunchOptions = {
  profileDir: string;
  headless: boolean;
  viewport: { width: number; height: number };
  touch: boolean;
  locale?: string;
  /** Why the browser may not open `href`, or null when it may. */
  refuseNavigation: (href: string) => string | null;
};

export type LocalDriver = BrowserDriver & {
  /** Why the browser refused to open a page since the last call, if it did; reading it resets it. */
  takeRefusal(): string | null;
  /** The page waits since the last call; reading them resets them. */
  takeWaits?(): PageWait[];
  /** A small JPEG of the active tab's viewport, or null when there is none. */
  thumbnail?(): Promise<Uint8Array | null>;
};

export class PlaywrightDriver implements LocalDriver {
  readonly context: PlaywrightContext;
  private readonly browserContext: BrowserContext;
  private refusal: string | null = null;

  private constructor(context: BrowserContext) {
    this.browserContext = context;
    this.context = new PlaywrightContext(context);
  }

  /**
   * The installed Google Chrome, or Playwright's own Chromium when Chrome is
   * missing and `npx playwright install chromium` has been run.
   */
  static async launch(options: LaunchOptions): Promise<PlaywrightDriver> {
    const settings = {
      headless: options.headless,
      viewport: options.viewport,
      hasTouch: options.touch,
      ...(options.locale ? { locale: options.locale } : {}),
    };
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(options.profileDir, {
        ...settings,
        channel: 'chrome',
      });
    } catch (chromeError) {
      // A kept profile in use by another run is locked; another browser will not help.
      if (/ProcessSingleton|SingletonLock|already in use/i.test((chromeError as Error).message)) {
        throw new Error(
          "Another run is already using this actor's kept login (persist_login). Finish that run first, or try again when it ends.",
          { cause: chromeError }
        );
      }
      try {
        context = await chromium.launchPersistentContext(options.profileDir, settings);
      } catch {
        throw new Error(
          `Could not start Chrome (${(chromeError as Error).message.split('\n')[0]}). Install Google Chrome, or run \`npx playwright install chromium\`.`
        );
      }
    }
    const driver = new PlaywrightDriver(context);
    // The navigate tool checks its own URL, but links, scripts, popups and frames
    // navigate without it, so every navigation is checked here too. A refusal in
    // a tab's main frame is kept for the next tool result to explain.
    const refuse = (request: Request) => {
      const reason = request.isNavigationRequest() ? options.refuseNavigation(request.url()) : null;
      if (reason && !request.frame().parentFrame()) driver.refusal = reason;
      return reason;
    };
    await context.route('**/*', (route) =>
      refuse(route.request()) ? route.abort('blockedbyclient') : route.fallback()
    );
    // A route never sees a redirect's later hops: Playwright sends them on before
    // any handler runs. So a frame redirected somewhere refused goes to about:blank.
    context.on('request', (request) => {
      if (request.redirectedFrom() && refuse(request)) {
        request
          .frame()
          .goto('about:blank')
          .catch(() => {});
      }
    });
    if (context.pages().length === 0) await driver.context.newPage();
    return driver;
  }

  takeRefusal(): string | null {
    const refusal = this.refusal;
    this.refusal = null;
    return refusal;
  }

  takeWaits(): PageWait[] {
    return this.context.waits.take();
  }

  /**
   * Chrome scales the capture itself (DevTools' `clip.scale`), so a step's
   * picture costs tens of kilobytes rather than a full-size PNG, with no image
   * library to resize it.
   */
  async thumbnail(): Promise<Uint8Array | null> {
    const page = this.context.activePage()?.raw;
    if (!page) return null;
    let session = cdpSessions.get(page);
    if (!session) {
      session = this.browserContext.newCDPSession(page);
      cdpSessions.set(page, session);
      // A session that failed to open is tried again next time, not kept.
      session.catch(() => cdpSessions.delete(page));
    }
    const cdp = await session;
    // The visible area in document coordinates, so a scrolled page shows where it is scrolled to.
    const { cssVisualViewport: view } = await cdp.send('Page.getLayoutMetrics');
    if (!view.clientWidth || !view.clientHeight) return null;
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: THUMBNAIL_QUALITY,
      clip: {
        x: view.pageX,
        y: view.pageY,
        width: view.clientWidth,
        height: view.clientHeight,
        scale: Math.min(1, THUMBNAIL_WIDTH / view.clientWidth),
      },
    });
    return Buffer.from(data, 'base64');
  }

  /** Instruction-style actions need a model of their own. Nothing here calls them. */
  async act(): Promise<DriverActResult> {
    throw new Error('act is not supported by this driver: use the browser toolset instead');
  }
  async extract(): Promise<unknown> {
    throw new Error('extract is not supported by this driver: use the browser toolset instead');
  }
  close() {
    return this.browserContext.close();
  }
}
