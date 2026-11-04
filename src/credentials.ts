// The person's own model connection, kept in `~/.stuntdouble/credentials.json`
// beside their Stunt Double sign-in, never in the project's `.stuntdouble/`,
// never in a log and never sent to the page.
//
// Policy line: a standalone run uses only a connection the person configures,
// an Anthropic API key or an OpenAI-compatible endpoint. Nothing here reads a
// Claude subscription, `~/.claude` or Claude Code's credentials. Only the
// Studio (studio.ts, cli.ts) imports this module; the MCP server never does
// (test/no-model.test.ts). The file itself is credentials-file.ts.

import { z } from 'zod';

import { readCredentials, updateCredentials } from './credentials-file.ts';

export const PROVIDERS = ['anthropic', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
};
export const DEFAULT_BASE_URLS: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};
/** The environment variable each provider's key may come from instead. */
const KEY_ENV: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

const ConnectionSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string().min(1).max(200),
  base_url: z.url({ protocol: /^https?$/ }).nullish(),
  api_key: z.string().max(500).nullish(),
});
export type StoredConnection = z.infer<typeof ConnectionSchema>;

/** A connection ready to call, key included. Never leaves this process. */
export type Connection = {
  provider: Provider;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  keySource: 'stored' | 'env' | 'none';
};

/**
 * The connection a run uses: the stored one, its key from the file or else the
 * provider's environment variable. With nothing stored, an `ANTHROPIC_API_KEY`
 * in the environment is enough on its own.
 */
export async function resolveConnection(): Promise<Connection | null> {
  const parsed = ConnectionSchema.safeParse((await readCredentials()).connection);
  const stored = parsed.success ? parsed.data : undefined;
  const provider: Provider | null =
    stored?.provider ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : null);
  if (!provider) return null;
  const envKey =
    provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env[KEY_ENV.openai];
  const apiKey = stored?.api_key || envKey || null;
  return {
    provider,
    model: stored?.model ?? DEFAULT_MODELS[provider],
    baseUrl: (stored?.base_url || DEFAULT_BASE_URLS[provider]).replace(/\/+$/, ''),
    apiKey,
    keySource: stored?.api_key ? 'stored' : envKey ? 'env' : 'none',
  };
}

/** What the page may know: whether a key is set and where from, never the key. */
export async function connectionStatus() {
  const c = await resolveConnection();
  if (!c) return { configured: false as const };
  return {
    configured: true as const,
    provider: c.provider,
    model: c.model,
    base_url: c.baseUrl,
    key: c.keySource,
    key_env: KEY_ENV[c.provider],
  };
}

/** Save the connection. An empty `api_key` keeps the stored one; `clear_key` drops it. */
export async function saveConnection(input: {
  provider: Provider;
  model: string;
  base_url?: string | null;
  api_key?: string | null;
  clear_key?: boolean;
}): Promise<void> {
  await updateCredentials((current) => {
    const old = ConnectionSchema.safeParse(current.connection);
    const keep = old.success && old.data.provider === input.provider ? old.data.api_key : null;
    const connection = ConnectionSchema.parse({
      provider: input.provider,
      model: input.model.trim(),
      base_url: input.base_url?.trim() || null,
      api_key: input.clear_key ? null : input.api_key?.trim() || keep || null,
    });
    return { ...current, connection };
  });
}
