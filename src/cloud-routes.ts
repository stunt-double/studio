// Stunt Double sign-in over HTTP (`/api/studio/cloud/*` and `/oauth/callback`),
// shared by Studio (studio.ts) and the viewer Claude Code opens (viewer.ts).
// The guards are the viewer's (ui-server.ts): loopback Host, the key cookie,
// and for writes this server's Origin and a JSON body. The token never leaves
// cloud.ts: the page is told only whether someone is signed in, and where to.

import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  beginLogin,
  chooseWorkspace,
  cloudStatus,
  completeLogin,
  listWorkspaces,
  logout,
} from './cloud.ts';
import { send } from './ui-server.ts';

const json = (res: ServerResponse, status: number, data: unknown) =>
  send(res, status, JSON.stringify(data), 'application/json');

/** `back`: where the callback page sends the browser once signed in. */
export function cloudRoutes(options: { back: string }) {
  async function get(path: string, res: ServerResponse): Promise<boolean> {
    if (path === '/api/studio/cloud') json(res, 200, await cloudStatus());
    else if (path === '/api/studio/cloud/workspaces') {
      json(res, 200, { workspaces: await listWorkspaces() });
    } else return false;
    return true;
  }

  /** `port`: this viewer's, for the loopback redirect. */
  async function post(
    path: string,
    body: unknown,
    res: ServerResponse,
    port: number
  ): Promise<boolean> {
    if (path === '/api/studio/cloud/login') {
      json(res, 200, { url: await beginLogin(`http://127.0.0.1:${port}/oauth/callback`) });
    } else if (path === '/api/studio/cloud/logout') {
      await logout();
      json(res, 200, await cloudStatus());
    } else if (path === '/api/studio/cloud/workspace') {
      const id = (body as { id?: unknown }).id;
      if (typeof id !== 'string') json(res, 400, { error: 'Name a workspace.' });
      else json(res, 200, { workspace: await chooseWorkspace(id) });
    } else return false;
    return true;
  }

  async function oauthCallback(_req: IncomingMessage, res: ServerResponse, url: URL) {
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code');
    let message = 'Signed in to Stunt Double.';
    let ok = true;
    try {
      if (!code)
        throw new Error(url.searchParams.get('error_description') ?? 'Sign-in was cancelled.');
      await completeLogin(state, code);
    } catch (err) {
      ok = false;
      message = (err as Error).message;
    }
    const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    // A same-origin navigation from here carries the Strict cookie again.
    send(
      res,
      ok ? 200 : 400,
      `<!doctype html><meta charset="utf-8"><title>Stunt Double Studio</title>${ok ? `<meta http-equiv="refresh" content="1;url=${options.back}">` : ''}<body style="font:15px system-ui;padding:3rem;max-width:32rem"><p>${escape(message)}</p><p><a href="${options.back}">Back to the Studio</a></p></body>`,
      'text/html; charset=utf-8',
      { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" }
    );
  }

  return { get, post, oauthCallback };
}
