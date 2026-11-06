// The monorepo's own UMUX cases (packages/platform/src/interviews/usability.test.ts at 9212f3a),
// run against the vendored copy, so a local interview scores as a cloud one does.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dominantUsabilityScale,
  formatUsabilityScore,
  itemContribution,
  normaliseUsabilityResponse,
  normaliseUsabilityScale,
  scoreUsabilityResponse,
  summariseUsability,
  umuxLiteToSus,
  usabilityBand,
  usabilityGrade,
  usabilityItems,
  usabilityStatement,
  type UsabilityResponse,
} from '../src/vendor/usability/usability.ts';

function umux(capabilities: number, frustration: number, ease: number, correction: number) {
  return {
    scale: 'umux',
    ratings: [
      { item: 'capabilities', rating: capabilities, reason: null },
      { item: 'frustration', rating: frustration, reason: null },
      { item: 'ease', rating: ease, reason: null },
      { item: 'correction', rating: correction, reason: null },
    ],
    answered_at: null,
  } satisfies UsabilityResponse;
}

function lite(capabilities: number, ease: number): UsabilityResponse {
  return {
    scale: 'umux_lite',
    ratings: [
      { item: 'capabilities', rating: capabilities, reason: null },
      { item: 'ease', rating: ease, reason: null },
    ],
    answered_at: null,
  };
}

test('UMUX-Lite asks the two positive items, UMUX all four, off asks nothing', () => {
  assert.deepEqual(
    usabilityItems('umux').map((i) => i.id),
    ['capabilities', 'frustration', 'ease', 'correction']
  );
  assert.deepEqual(
    usabilityItems('umux_lite').map((i) => i.id),
    ['capabilities', 'ease']
  );
  assert.deepEqual(usabilityItems('none'), []);
});

test('an unknown stored scale reads as off', () => {
  assert.equal(normaliseUsabilityScale('sus'), 'none');
  assert.equal(normaliseUsabilityScale(null), 'none');
  assert.equal(normaliseUsabilityScale('umux_lite'), 'umux_lite');
});

test('statements name the product and start with a capital', () => {
  const [first] = usabilityItems('umux');
  assert.equal(
    usabilityStatement(first!, 'shop.example'),
    "Shop.example's capabilities meet my requirements."
  );
  assert.equal(
    usabilityStatement(first!, ' '),
    "This product's capabilities meet my requirements."
  );
});

test('negative items are reversed', () => {
  assert.equal(itemContribution('capabilities', 7), 6);
  assert.equal(itemContribution('capabilities', 1), 0);
  assert.equal(itemContribution('frustration', 1), 6);
  assert.equal(itemContribution('frustration', 7), 0);
});

test('UMUX scores the ends and the middle of the scale', () => {
  assert.equal(scoreUsabilityResponse(umux(7, 1, 7, 1))!.raw, 100);
  assert.equal(scoreUsabilityResponse(umux(1, 7, 1, 7))!.raw, 0);
  assert.equal(scoreUsabilityResponse(umux(4, 4, 4, 4))!.raw, 50);
  // (5-1) + (7-3) + (6-1) + (7-2) = 18 of 24.
  const s = scoreUsabilityResponse(umux(5, 3, 6, 2))!;
  assert.equal(s.raw, 75);
  assert.equal(s.susEquivalent, 75);
});

test('UMUX-Lite is rescaled to the SUS by the published regression', () => {
  const s = scoreUsabilityResponse(lite(7, 7))!;
  assert.equal(s.raw, 100);
  assert.equal(s.susEquivalent, umuxLiteToSus(100));
  assert.ok(Math.abs(s.susEquivalent - 87.9) < 1e-9);
  assert.ok(Math.abs(scoreUsabilityResponse(lite(1, 1))!.susEquivalent - 22.9) < 1e-9);
});

test('an incomplete response is not scored', () => {
  const partial: UsabilityResponse = {
    ...umux(5, 3, 6, 2),
    ratings: umux(5, 3, 6, 2).ratings.slice(0, 3),
  };
  assert.equal(scoreUsabilityResponse(partial), null);
});

test('normalising clamps, drops unknown and unasked items, and keeps the last answer', () => {
  const r = normaliseUsabilityResponse({
    scale: 'umux_lite',
    ratings: [
      { item: 'capabilities', rating: 9.4, reason: '  fine ' },
      { item: 'frustration', rating: 2 },
      { item: 'mood', rating: 4 },
      { item: 'ease', rating: 3 },
      { item: 'ease', rating: 0 },
      { item: 'capabilities', rating: '5' },
    ],
    answered_at: '2026-10-08T00:00:00.000Z',
  });
  assert.deepEqual(r, {
    scale: 'umux_lite',
    ratings: [
      { item: 'capabilities', rating: 7, reason: 'fine' },
      { item: 'ease', rating: 1, reason: null },
    ],
    answered_at: '2026-10-08T00:00:00.000Z',
  });
});

test('normalising reads nothing usable as null', () => {
  assert.equal(normaliseUsabilityResponse(null), null);
  assert.equal(normaliseUsabilityResponse([]), null);
  assert.equal(normaliseUsabilityResponse({ scale: 'none', ratings: [] }), null);
  assert.equal(normaliseUsabilityResponse({ scale: 'umux', ratings: [{ item: 'ease' }] }), null);
});

test('grades follow the curved grading scale', () => {
  assert.deepEqual(
    [100, 84.1, 84.04, 80.8, 78.9, 77.2, 74.1, 72.6, 71.1, 68, 65, 62.7, 51.7, 51.6, 0].map(
      usabilityGrade
    ),
    ['A+', 'A+', 'A', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C', 'C-', 'D', 'F', 'F']
  );
  assert.equal(usabilityBand('A-'), 'excellent');
  assert.equal(usabilityBand('B+'), 'good');
  assert.equal(usabilityBand('C-'), 'ok');
  assert.equal(usabilityBand('D'), 'poor');
});

test('a round summary carries the mean, spread, interval and per-item reading', () => {
  const summary = summariseUsability('umux', [
    umux(7, 1, 7, 1), // 100
    umux(4, 4, 4, 4), // 50
    umux(5, 3, 6, 2), // 75
    { ...umux(5, 3, 6, 2), ratings: umux(5, 3, 6, 2).ratings.slice(0, 2) }, // incomplete
    lite(7, 7), // another scale, ignored
    null,
  ])!;
  assert.equal(summary.respondents, 3);
  assert.equal(summary.incomplete, 1);
  assert.equal(summary.mean, 75);
  assert.equal(summary.sd, 25);
  // t(2) = 4.303, margin = 4.303 * 25 / sqrt(3).
  assert.ok(Math.abs(summary.ci95!.low - Math.max(0, 75 - (4.303 * 25) / Math.sqrt(3))) < 1e-9);
  assert.equal(summary.ci95!.high, 100);
  assert.equal(summary.min, 50);
  assert.equal(summary.max, 100);
  assert.equal(summary.grade, 'B');
  assert.equal(summary.vsBenchmark, 7);

  const frustration = summary.items.find((i) => i.item === 'frustration')!;
  assert.equal(frustration.tone, 'negative');
  assert.equal(frustration.meanRating, (1 + 4 + 3) / 3);
  assert.deepEqual(frustration.distribution, [1, 0, 1, 1, 0, 0, 0]);
  assert.equal(frustration.meanScore, ((6 + 3 + 4) / 3 / 6) * 100);
});

test('one respondent has a mean but no spread or interval', () => {
  const summary = summariseUsability('umux_lite', [lite(6, 5)])!;
  assert.equal(summary.respondents, 1);
  assert.equal(summary.sd, null);
  assert.equal(summary.ci95, null);
  assert.ok(Math.abs(summary.meanRaw - 75) < 1e-9);
  assert.ok(Math.abs(summary.mean - umuxLiteToSus(75)) < 1e-9);
});

test('nobody scoreable is no summary', () => {
  assert.equal(summariseUsability('umux', []), null);
  assert.equal(summariseUsability('umux', [lite(7, 7)]), null);
});

test('the dominant scale is the one most participants answered on', () => {
  assert.equal(dominantUsabilityScale([]), null);
  assert.equal(dominantUsabilityScale([null, lite(1, 1)]), 'umux_lite');
  assert.equal(dominantUsabilityScale([lite(1, 1), umux(1, 1, 1, 1), umux(1, 1, 1, 1)]), 'umux');
});

test('scores format to one decimal place without a negative zero', () => {
  assert.equal(formatUsabilityScore(72.345), '72.3');
  assert.equal(formatUsabilityScore(-0.01), '0.0');
});
