// What the viewer adds when Claude Code (or another agent) opened it over MCP:
// a run sent back into that session, and Stunt Double sign-in with cloud runs.
//
// "Run in Claude Code" is a Claude Code channel event (mcp.ts declares the
// `claude/channel` capability). Claude Code drops the event silently unless the
// session was started with the channel on, so the page waits for the run to
// appear and otherwise offers the command to paste. The event's text is built
// here from a validated slug, never from anything the page sends.
//
// Nothing here calls a model: a local run is the session's own, and a cloud
// run is the hosted MCP's, billed to the workspace.

import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';

import { agentKind, type ClientInfo } from './agents.ts';
import { cloudRoutes } from './cloud-routes.ts';
import { CloudRefusal, cloudStatus, startCloudRun } from './cloud.ts';
import { readBody, send, type UiExtension } from './ui-server.ts';

const json = (res: ServerResponse, status: number, data: unknown) =>
  send(res, status, JSON.stringify(data), 'application/json');

export type ChannelEvent = { content: string; meta: Record<string, string> };

/** What the session reads when an event arrives: the MCP server's instructions. */
export const CHANNEL_INSTRUCTIONS =
  'Stunt Double Studio can send events as <channel source="..." checklist="..." resume="...">: the person pressed Run in Studio. Run that checklist as `/stuntdouble run <checklist>` does: call start_run with the checklist (and resume: true when resume="true"), then dispatch the stuntdouble:stuntdouble-actor agent with its full output, and report the result. Nothing else arrives this way.';

/** The command that does the same by hand, for a session without the channel. */
export const runCommand = (checklist: string, resume?: boolean) =>
  `/stuntdouble run ${checklist}${resume ? ' resume' : ''}`;

const RunInput = z.object({
  checklist: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  where: z.enum(['agent', 'cloud']),
  resume: z.boolean().optional(),
});

export function viewerExtension(options: {
  project: string;
  /** The agent connected over MCP, once it has said who it is. */
  client(): ClientInfo | undefined;
  notify(event: ChannelEvent): Promise<void>;
  cloudPollMs?: number;
}): UiExtension {
  const cloud = cloudRoutes({ back: '/' });

  async function run(res: ServerResponse, body: unknown): Promise<void> {
    const input = RunInput.safeParse(body);
    if (!input.success) return json(res, 400, { error: 'Name a checklist to run.' });
    const { checklist, where, resume } = input.data;
    if (where === 'cloud') {
      const started = await startCloudRun({
        project: options.project,
        checklist,
        pollMs: options.cloudPollMs,
      });
      started.done.catch(() => {});
      return json(res, 200, { run_id: started.runId });
    }
    const client = options.client();
    if (!client || agentKind(client.name) !== 'claude-code') {
      return json(res, 409, { error: 'No Claude Code session is connected to this viewer.' });
    }
    await options.notify({
      content: `Run the Stunt Double checklist ${checklist}${resume ? ', resuming its unfinished run' : ''}. The person asked for it from Studio.`,
      meta: { checklist, resume: String(Boolean(resume)) },
    });
    return json(res, 202, { command: runCommand(checklist, resume) });
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    if (req.method !== 'GET' && req.method !== 'POST') return false;
    try {
      if (req.method === 'GET') {
        if (path === '/viewer.js') {
          const script = await readFile(new URL('./viewer.js', import.meta.url));
          send(res, 200, script, 'text/javascript; charset=utf-8');
        } else if (path === '/api/viewer') {
          const client = options.client();
          json(res, 200, {
            agent: client ? { name: client.name, kind: agentKind(client.name) } : null,
            cloud: await cloudStatus(),
          });
        } else return await cloud.get(path, res);
        return true;
      }
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        json(res, 400, { error: 'That was not JSON.' });
        return true;
      }
      if (path === '/api/viewer/run') await run(res, body);
      else return await cloud.post(path, body, res, Number(url.port));
    } catch (err) {
      // Our own errors say what to fix (a file, a refusal from Stunt Double); the page shows them as text.
      json(res, err instanceof CloudRefusal ? 403 : 400, { error: (err as Error).message });
    }
    return true;
  }

  return { script: '/viewer.js', handle, oauthCallback: cloud.oauthCallback };
}
