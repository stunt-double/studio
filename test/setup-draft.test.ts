/**
 * The model-drafted setup, with a mocked fetch: a valid answer, a fenced one,
 * invalid output that is retried once with the problems named, and output that
 * stays invalid. The one call goes through model.ts on the person's connection.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Connection } from '../src/credentials.ts';
import { DraftError, draftWithModel, extractJson } from '../src/setup-draft.ts';
import { templateDraft, type DraftContext } from '../src/setup.ts';

const context: DraftContext = {
  url: 'http://localhost:3000',
  routes: [
    { path: '/', source: 'app/' },
    { path: '/pricing', source: 'app/' },
  ],
  product: { name: 'Mug Shop', description: 'Mugs, online', readme: '# Mug Shop\nFor mug lovers.' },
  description: 'Someone buying a gift',
};

const connection: Connection = {
  provider: 'openai',
  model: 'scripted',
  baseUrl: 'http://model.test/v1',
  apiKey: 'sk-test',
  keySource: 'stored',
};

const valid = templateDraft(context);

/** A fetch that answers each chat completion request with the next reply. */
function scripted(replies: string[]) {
  const requests: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({
      url,
      body,
      auth: (init.headers as Record<string, string>).authorization ?? null,
    });
    const content = replies[requests.length - 1] ?? 'nothing more';
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 900, completion_tokens: 100, cost: 0.002 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as unknown as typeof fetch;
  return { fetchFn, requests };
}

test('a valid answer is one call on the person’s connection, with its cost', async () => {
  const { fetchFn, requests } = scripted([JSON.stringify(valid)]);
  const result = await draftWithModel({ connection, context, fetch: fetchFn });
  assert.equal(result.attempts, 1);
  assert.deepEqual(
    result.draft.checklists.map((c) => c.slug),
    valid.checklists.map((c) => c.slug)
  );
  assert.deepEqual(
    [result.usage.input_tokens, result.usage.output_tokens, result.usage.cost_usd],
    [900, 100, 0.002]
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, 'http://model.test/v1/chat/completions');
  assert.equal(requests[0]!.auth, 'Bearer sk-test');
  // The routes, the README and the person's line reach the model; no tools are offered.
  const sent = JSON.stringify(requests[0]!.body.messages);
  assert.match(sent, /\/pricing/);
  assert.match(sent, /For mug lovers/);
  assert.match(sent, /Someone buying a gift/);
  assert.equal(requests[0]!.body.tools, undefined);
});

test('a code fence or a sentence around the JSON is tolerated', async () => {
  const { fetchFn } = scripted([`Here you go:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``]);
  assert.equal((await draftWithModel({ connection, context, fetch: fetchFn })).attempts, 1);
  assert.throws(() => extractJson('no object here'), /no JSON object/);
});

test('invalid output is retried once, with the problems named, and the costs add up', async () => {
  const wrong = structuredClone(valid);
  wrong.checklists[0]!.checks = [{ key: 'Bad Key', description: 'x' }];
  wrong.checklists[0]!.pass_threshold = 80;
  const { fetchFn, requests } = scripted(['this is not json', JSON.stringify(valid)]);
  const result = await draftWithModel({ connection, context, fetch: fetchFn });
  assert.equal(result.attempts, 2);
  assert.equal(requests.length, 2);
  assert.equal(result.usage.input_tokens, 1800);
  assert.ok(Math.abs(result.usage.cost_usd! - 0.004) < 1e-9);
  assert.match(JSON.stringify(requests[1]!.body.messages), /not valid/);

  const second = scripted([JSON.stringify(wrong), JSON.stringify(valid)]);
  await draftWithModel({ connection, context, fetch: second.fetchFn });
  const retry = JSON.stringify(second.requests[1]!.body.messages);
  assert.match(retry, /checklists\.0\.checks\.0\.key/);
  assert.match(retry, /checklists\.0\.pass_threshold/);
});

test('output that stays invalid fails after the retry, with the issues', async () => {
  const wrong = structuredClone(valid);
  wrong.checklists[0]!.url = 'https://elsewhere.example/';
  const { fetchFn, requests } = scripted([JSON.stringify(wrong), JSON.stringify(wrong)]);
  await assert.rejects(
    draftWithModel({ connection, context, fetch: fetchFn }),
    (err: unknown) =>
      err instanceof DraftError &&
      err.issues.some((i) => i.path === 'checklists.0.url') &&
      /even after a retry/.test(err.message)
  );
  assert.equal(requests.length, 2);
});
