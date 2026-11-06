/**
 * A local interview: the guide asked in order, the questionnaire after it,
 * scored by the vendored UMUX code, and the session kept in
 * `interview-runs/<id>/interview.json`, out of the checklist runs.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { LocalDriver } from '../src/driver.ts';
import { InterviewRunSchema, readRuns } from '../src/files.ts';
import { LocalSession } from '../src/run.ts';
import { startUi } from '../src/ui-server.ts';

function fakeDriver() {
  let current = 'about:blank';
  const page = {
    id: 'page-1',
    goto: async (url: string) => {
      current = url;
    },
    url: () => current,
    title: async () => 'Shop',
    screenshot: async () => Buffer.from('png'),
    evaluate: async () => ({ ok: true, text: 'heading "Mugs"', truncated: false }),
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    close: async () => {},
  };
  let closed = false;
  const driver = {
    context: { activePage: async () => page, pages: async () => [page] },
    takeRefusal: () => null,
    takeWaits: () => [],
    thumbnail: async () => Buffer.from([0xff, 0xd8, 0xff]),
    close: async () => {
      closed = true;
    },
  } as unknown as LocalDriver;
  return { driver, isClosed: () => closed };
}

const projects: string[] = [];
after(() => Promise.all(projects.map((p) => rm(p, { recursive: true, force: true }))));

const GUIDE = {
  name: 'First visit',
  actor: 'shopper',
  url: 'https://www.mugs.example/shop',
  research_brief: 'Do first-time visitors trust the checkout?',
  sections: [
    {
      title: 'First impressions',
      intro: 'Take a look around the home page.',
      items: [{ prompt: 'What do you think this site sells?' }],
    },
    {
      title: 'Buying',
      items: [
        { type: 'task', prompt: 'Find the cheapest mug and add it to your basket.' },
        { prompt: 'How confident would you feel paying here?' },
      ],
    },
  ],
};

async function project(interview: Record<string, unknown> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'stuntdouble-interview-'));
  projects.push(dir);
  const sd = join(dir, '.stuntdouble');
  await mkdir(join(sd, 'actors'), { recursive: true });
  await mkdir(join(sd, 'interviews'), { recursive: true });
  const json = (data: unknown) => JSON.stringify(data, null, 2);
  await writeFile(join(sd, 'stuntdouble.json'), json({ format: 'stuntdouble/1', headless: true }));
  await writeFile(
    join(sd, 'actors', 'shopper.json'),
    json({ name: 'First-time shopper', description: 'New to the site' })
  );
  await writeFile(join(sd, 'interviews', 'first-visit.json'), json({ ...GUIDE, ...interview }));
  return dir;
}

async function session(dir: string) {
  const browser = fakeDriver();
  return {
    browser,
    session: new LocalSession({ project: dir, launch: async () => browser.driver }),
  };
}

const sessionDir = async (dir: string) => {
  const [id] = await readdir(join(dir, '.stuntdouble', 'interview-runs'));
  return { id: id!, path: join(dir, '.stuntdouble', 'interview-runs', id!) };
};

const RATINGS = [
  { item: 'capabilities' as const, rating: 6, reason: 'It had the mug I wanted.' },
  { item: 'frustration' as const, rating: 2, reason: 'Only the basket was slow.' },
  { item: 'ease' as const, rating: 6, reason: 'Everything was where I looked.' },
  { item: 'correction' as const, rating: 2, reason: 'I fixed one typo.' },
];

test('an interview asks each item in turn, then UMUX, and scores it as the cloud does', async () => {
  const dir = await project();
  const { browser, session: s } = await session(dir);
  const started = await s.startInterview({ interview: 'first-visit' });
  assert.match(started, /You are First-time shopper: New to the site\./);
  assert.match(
    started,
    /a research interview about mugs\.example, starting at https:\/\/www\.mugs\.example\/shop/
  );
  assert.match(started, /There are 3 items\./);
  // The researcher's purpose would colour the answers, so the actor is not told it.
  assert.doesNotMatch(started, /trust the checkout/);
  assert.match(
    started,
    /Item 1 of 3, in "First impressions":\nTake a look around the home page\.\nQuestion: What do you think this site sells\?/
  );

  // Checklist tools do not reach an interview.
  await assert.rejects(
    s.evaluateCheck({ check: 'x', status: 'passed', evidence: 'x' }),
    /Interview .* is going, not a checklist run/
  );
  await assert.rejects(s.rateUsability({ ratings: RATINGS }), /Answer every item first: 3 left/);

  assert.match(
    await s.answerItem({ answer: 'Mugs, and a lot of them.' }),
    /Recorded the answer to item 1 of 3\.\n\nItem 2 of 3, in "Buying":\nTask: Find the cheapest mug/
  );
  await s.browserTool('navigate', { url: 'https://www.mugs.example/basket' });
  await s.answerItem({ answer: 'Found it under Sale, added it in two clicks.' });
  const last = await s.answerItem({ answer: 'Fairly, the padlock and PayPal help.' });
  assert.match(
    last,
    /rate how much you agree with each statement, from 1 to 7 \(1 Strongly disagree/
  );
  assert.match(last, /- capabilities: "Mugs\.example's capabilities meet my requirements\."/);
  assert.match(
    last,
    /- correction: "I have to spend too much time correcting things with mugs\.example\."/
  );
  await assert.rejects(s.answerItem({ answer: 'More.' }), /Every item already has an answer/);

  await assert.rejects(
    s.rateUsability({ ratings: RATINGS.slice(0, 3) }),
    /Rate each statement exactly once: capabilities, frustration, ease, correction\. Missing: correction\./
  );
  await assert.rejects(
    s.rateUsability({ ratings: [...RATINGS, RATINGS[0]!] }),
    /Rate each statement exactly once/
  );
  // 5 + 5 + 5 + 5 of 24 is 83.3: an A on the Sauro-Lewis curve.
  assert.match(
    await s.rateUsability({ ratings: [...RATINGS].reverse() }),
    /Recorded the ratings: UMUX 83\.3, grade A \(Excellent\)\.\n\nThe interview is done: call finish_interview/
  );
  await assert.rejects(s.rateUsability({ ratings: RATINGS }), /already has its ratings/);

  const finished = await s.finishInterview({ summary: 'Easy to buy, a little slow.' });
  assert.match(
    finished,
    /completed: 3\/3 items answered\. Usability: UMUX 83\.3, grade A \(Excellent\)\. Self-reported/
  );
  assert.match(finished, /\.stuntdouble\/interview-runs\/\d{8}-\d{6}-first-visit\/interview\.json/);
  assert.ok(browser.isClosed());
  assert.match(await s.finishInterview({ summary: 'Again.' }), /has already finished/);

  const { id, path } = await sessionDir(dir);
  const run = InterviewRunSchema.parse(
    JSON.parse(await readFile(join(path, 'interview.json'), 'utf8'))
  );
  assert.equal(run.status, 'completed');
  assert.equal(run.interview, 'first-visit');
  assert.equal(run.runner.judged, false);
  assert.deepEqual(
    run.transcript.map((t) => [t.section, t.item, t.type, t.answer]),
    [
      [0, 0, 'question', 'Mugs, and a lot of them.'],
      [1, 0, 'task', 'Found it under Sale, added it in two clicks.'],
      [1, 1, 'question', 'Fairly, the padlock and PayPal help.'],
    ]
  );
  // Stored in the statements' order, as the cloud stores them, whatever order they came in.
  assert.deepEqual(run.usability?.ratings, RATINGS);
  assert.equal(run.usability?.scale, 'umux');
  assert.equal(run.summary, 'Easy to buy, a little slow.');

  const tools = (await readFile(join(path, 'activity.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l).tool);
  assert.deepEqual(tools, [
    'start_interview',
    'navigate',
    'answer_item',
    'navigate',
    'answer_item',
    'answer_item',
    'rate_usability',
    'finish_interview',
  ]);
  assert.deepEqual((await readdir(join(path, 'steps'))).sort(), ['0001.jpg', '0002.jpg']);
  // An interview is not a checklist run: runs/ stays empty, so no viewer lists it as unreadable.
  assert.deepEqual(await readRuns(join(dir, '.stuntdouble')), []);

  // The viewer's API: the list carries the score, not the answers; one session carries both.
  const ui = await startUi({ root: join(dir, '.stuntdouble') });
  try {
    const signIn = await fetch(ui.link(), { redirect: 'manual' });
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0]!;
    const list = (await (
      await fetch(`http://127.0.0.1:${ui.port}/api/interview-runs`, { headers: { Cookie: cookie } })
    ).json()) as Record<string, unknown>[];
    assert.equal(list.length, 1);
    assert.equal(list[0]!.interview_name, 'First visit');
    assert.equal(list[0]!.answered, 3);
    assert.equal(list[0]!.items, 3);
    assert.equal((list[0]!.usability_score as { grade: string }).grade, 'A');
    assert.equal(list[0]!.transcript, undefined);
    const one = (await (
      await fetch(`http://127.0.0.1:${ui.port}/api/interview-runs/${id}`, {
        headers: { Cookie: cookie },
      })
    ).json()) as {
      run: { transcript: unknown[]; usability_score: { raw: number } };
      activity: unknown[];
    };
    assert.equal(one.run.transcript.length, 3);
    assert.equal(Math.round(one.run.usability_score.raw * 10) / 10, 83.3);
    assert.equal(one.activity.length, 8);
  } finally {
    await ui.close();
  }
});

test('UMUX-Lite asks the two positive statements and grades on the SUS scale', async () => {
  const dir = await project({
    usability_scale: 'umux_lite',
    sections: [{ title: 'Only', items: [{ prompt: 'Anything to say?' }] }],
  });
  const { session: s } = await session(dir);
  await s.startInterview({ interview: 'first-visit' });
  const asked = await s.answerItem({ answer: 'Not really.' });
  assert.match(asked, /Record all 2 with rate_usability/);
  assert.doesNotMatch(asked, /frustrat/);
  await assert.rejects(s.rateUsability({ ratings: RATINGS }), /Not asked: frustration, correction/);
  // 6 + 6 of 12 is 100 raw, 87.9 on the SUS scale (0.65 x 100 + 22.9).
  assert.match(
    await s.rateUsability({
      ratings: [
        { item: 'capabilities', rating: 7, reason: 'All of it.' },
        { item: 'ease', rating: 7, reason: 'Very.' },
      ],
    }),
    /UMUX-Lite 100\.0 \(87\.9 on the SUS scale\), grade A\+ \(Excellent\)/
  );
  await s.close();
});

test('an interview with the questionnaire off ends after the last item', async () => {
  const dir = await project({
    usability_scale: 'none',
    sections: [{ title: 'Only', items: [{ prompt: 'Anything to say?' }] }],
  });
  const { session: s } = await session(dir);
  const started = await s.startInterview({ interview: 'first-visit' });
  assert.doesNotMatch(started, /rate_usability/);
  assert.match(
    await s.answerItem({ answer: 'No.' }),
    /The interview is done: call finish_interview/
  );
  await assert.rejects(s.rateUsability({ ratings: RATINGS }), /asks no questionnaire/);
  const finished = await s.finishInterview({ summary: 'Short.' });
  assert.match(finished, /completed: 1\/1 items answered\. Self-reported/);
  assert.doesNotMatch(finished, /No usability score/);
});

test('an interrupted interview resumes from its first unanswered item', async () => {
  const dir = await project();
  const first = await session(dir);
  await first.session.startInterview({ interview: 'first-visit' });
  await first.session.answerItem({ answer: 'Mugs.' });
  await first.session.close();
  const { path } = await sessionDir(dir);
  const interrupted = InterviewRunSchema.parse(
    JSON.parse(await readFile(join(path, 'interview.json'), 'utf8'))
  );
  assert.equal(interrupted.status, 'interrupted');

  const second = await session(dir);
  await assert.rejects(
    second.session.startRun({ checklist: 'first-visit' }),
    /checklists\/first-visit\.json: file not found/
  );
  const resumed = await second.session.startInterview({ interview: 'first-visit', resume: true });
  assert.match(resumed, /it is resuming: your 1 earlier answers stand/);
  assert.match(resumed, /Item 2 of 3, in "Buying":\nTask: Find the cheapest mug/);
  // A checklist run cannot start over an open interview.
  await assert.rejects(second.session.startRun({ checklist: 'checkout' }), /Interview .* is going/);
  await second.session.answerItem({ answer: 'Done.' });
  await second.session.close();
  const after = InterviewRunSchema.parse(
    JSON.parse(await readFile(join(path, 'interview.json'), 'utf8'))
  );
  assert.deepEqual(
    after.transcript.map((t) => t.answer),
    ['Mugs.', 'Done.']
  );
  assert.deepEqual(await readdir(join(dir, '.stuntdouble', 'interview-runs')), [after.id]);
});

test('with a local base URL the browser starts locally, but the product keeps its name', async () => {
  const dir = await project({ sections: [{ title: 'Only', items: [{ prompt: 'Thoughts?' }] }] });
  await writeFile(
    join(dir, '.stuntdouble', 'stuntdouble.json'),
    JSON.stringify({
      format: 'stuntdouble/1',
      local_base_url: 'http://localhost:4100',
      headless: true,
    })
  );
  const { session: s } = await session(dir);
  const started = await s.startInterview({ interview: 'first-visit' });
  assert.match(started, /about mugs\.example, starting at http:\/\/localhost:4100\/shop/);
  const asked = await s.answerItem({ answer: 'Fine.' });
  assert.match(asked, /"Mugs\.example is easy to use\."/);
  assert.doesNotMatch(asked, /localhost/);
  await s.close();
});

test('a missing or invalid interview file says what to fix', async () => {
  const dir = await project({ sections: [], usability_scale: 'sus' });
  const { session: s } = await session(dir);
  await assert.rejects(s.startInterview({ interview: 'first-visit' }), (err: Error) => {
    assert.match(err.message, /interviews\/first-visit\.json: usability_scale: Invalid option/);
    assert.match(err.message, /interviews\/first-visit\.json: sections: Too small/);
    return true;
  });
  await assert.rejects(
    s.startInterview({ interview: 'checkout' }),
    /interviews\/checkout\.json: file not found\. The interviews here are: first-visit\./
  );
  await assert.rejects(s.startInterview({ interview: '../x' }), /is not an interview slug/);
});
