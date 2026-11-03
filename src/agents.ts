// Which coding agents are connected to this project's MCP server. The person's
// own agent is the model: it connects to us (an MCP client), and this module
// only records that it did. Nothing here starts an agent or reads one's files.
//
// Each `stuntdouble mcp` process writes `.stuntdouble/.live/agents/<pid>.json`
// on `initialize` and removes it on exit. An entry whose pid is dead (a crash)
// is treated as gone.

import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { isAlive, writeJsonAtomic } from './files.ts';

export type AgentKind = 'claude-code' | 'codex' | 'other';

export type ClientInfo = { name: string; version: string };

/** The `clientInfo` each client sends on `initialize`. */
export function agentKind(name: string): AgentKind {
  if (name === 'claude-code') return 'claude-code';
  // Codex's MCP client reports `codex-mcp-client`; older builds `codex`.
  if (name === 'codex' || name.startsWith('codex-mcp-client')) return 'codex';
  return 'other';
}

export function agentLabel(name: string): string {
  const kind = agentKind(name);
  return kind === 'claude-code' ? 'Claude Code' : kind === 'codex' ? 'Codex' : `MCP client ${name}`;
}

const AgentSchema = z.object({
  name: z.string(),
  version: z.string(),
  label: z.string(),
  kind: z.enum(['claude-code', 'codex', 'other']),
  pid: z.number(),
  started_at: z.string(),
  project: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

const agentsDir = (root: string) => join(root, '.live', 'agents');

export async function registerAgent(
  root: string,
  project: string,
  client: ClientInfo,
  pid = process.pid
): Promise<void> {
  const agent: Agent = {
    name: client.name,
    version: client.version,
    label: agentLabel(client.name),
    kind: agentKind(client.name),
    pid,
    started_at: new Date().toISOString(),
    project,
  };
  await writeJsonAtomic(join(agentsDir(root), `${pid}.json`), agent);
}

export async function unregisterAgent(root: string, pid = process.pid): Promise<void> {
  await rm(join(agentsDir(root), `${pid}.json`), { force: true });
}

/** The agents connected now, newest first. Entries left by a dead pid are ignored and tidied away. */
export async function listAgents(root: string): Promise<Agent[]> {
  const dir = agentsDir(root);
  const files = await readdir(dir).catch(() => []);
  const agents: Agent[] = [];
  for (const file of files.filter((f) => /^\d+\.json$/.test(f))) {
    const parsed = await readFile(join(dir, file), 'utf8')
      .then((t) => AgentSchema.safeParse(JSON.parse(t)))
      .catch(() => null);
    if (!parsed?.success) continue;
    if (isAlive(parsed.data.pid)) agents.push(parsed.data);
    else await rm(join(dir, file), { force: true });
  }
  return agents.sort((a, b) => b.started_at.localeCompare(a.started_at));
}
