// Vendored verbatim from the Stunt Double monorepo, packages/platform/src/interviews/usability.ts
// at 9212f3a, so a local interview's UMUX answers score exactly as a cloud interview's do. Do
// not edit it here: change the source and copy it again.
// ---------------------------------------------------------------------------
// Standardised usability questionnaires: UMUX and UMUX-Lite.
//
// An interview can close each participant's session with one of these. The
// participant rates every statement on a seven point agreement scale, in
// character, and this module turns the ratings into scores. It is pure (no
// I/O) so the dashboard, the MCP server and the run all score the same way,
// and so `node --test` covers it.
//
// Scoring follows the published instruments:
//
// - UMUX (Finstad, 2010): four items alternating positive and negative tone.
//   Positive items score `rating - 1`, negative items `7 - rating`, and the
//   sum (0 to 24) is rescaled to 0 to 100. It tracks the SUS closely, so it is
//   read against the SUS benchmarks as it is.
// - UMUX-Lite (Lewis, Utesch and Maher, 2013): the two positive items only,
//   rescaled the same way (0 to 12, then 0 to 100). Its raw score runs high
//   against the SUS, so `susEquivalent` applies the published regression
//   (`0.65 * raw + 22.9`) before a grade is given.
//
// Grades use the Sauro-Lewis curved grading scale for the SUS, whose centre
// (a C) is the long-run average of 68.
// ---------------------------------------------------------------------------

export const USABILITY_SCALES = ['none', 'umux', 'umux_lite'] as const;
export type UsabilityScale = (typeof USABILITY_SCALES)[number];
/** A scale that actually asks something. */
export type UsabilityInstrument = Exclude<UsabilityScale, 'none'>;

export type UsabilityItemId = 'capabilities' | 'frustration' | 'ease' | 'correction';

export type UsabilityItem = {
  id: UsabilityItemId;
  /** The statement as the participant reads it. `{product}` is substituted. */
  statement: string;
  /** Short label for charts and tables. */
  label: string;
  /** Agreement is good (positive) or bad (negative). */
  tone: 'positive' | 'negative';
};

export const UMUX_ITEMS: readonly UsabilityItem[] = [
  {
    id: 'capabilities',
    statement: "{product}'s capabilities meet my requirements.",
    label: 'Meets requirements',
    tone: 'positive',
  },
  {
    id: 'frustration',
    statement: 'Using {product} is a frustrating experience.',
    label: 'Frustrating',
    tone: 'negative',
  },
  {
    id: 'ease',
    statement: '{product} is easy to use.',
    label: 'Easy to use',
    tone: 'positive',
  },
  {
    id: 'correction',
    statement: 'I have to spend too much time correcting things with {product}.',
    label: 'Time spent correcting',
    tone: 'negative',
  },
];

export const RATING_MIN = 1;
export const RATING_MAX = 7;

/** The seven agreement anchors, index 0 being a rating of 1. */
export const RATING_ANCHORS = [
  'Strongly disagree',
  'Disagree',
  'Somewhat disagree',
  'Neither agree nor disagree',
  'Somewhat agree',
  'Agree',
  'Strongly agree',
] as const;

export const USABILITY_SCALE_LABELS: Record<UsabilityScale, string> = {
  none: 'Off',
  umux: 'UMUX',
  umux_lite: 'UMUX-Lite',
};

export const USABILITY_SCALE_DESCRIPTIONS: Record<UsabilityScale, string> = {
  none: 'No questionnaire at the end of each session.',
  umux: 'Four statements on effectiveness, satisfaction and efficiency. Comparable with SUS scores.',
  umux_lite: 'Two statements on usefulness and ease of use. Quickest to answer.',
};

export function isUsabilityScale(value: unknown): value is UsabilityScale {
  return typeof value === 'string' && (USABILITY_SCALES as readonly string[]).includes(value);
}

/** Reads a stored scale, treating anything unknown as off. */
export function normaliseUsabilityScale(value: unknown): UsabilityScale {
  return isUsabilityScale(value) ? value : 'none';
}

/** The statements a scale asks, in order. */
export function usabilityItems(scale: UsabilityScale): readonly UsabilityItem[] {
  if (scale === 'umux') return UMUX_ITEMS;
  if (scale === 'umux_lite') return UMUX_ITEMS.filter((i) => i.tone === 'positive');
  return [];
}

/** A statement with the product named, for the participant to read. */
export function usabilityStatement(item: UsabilityItem, product: string): string {
  const name = product.trim() || 'this product';
  const text = item.statement.replaceAll('{product}', name);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * What the statements call the product. The host names a live site the way a
 * participant would; a Figma stimulus study has no site, only the design.
 */
export function productNameFor(args: { targetUrl: string; stimulus: boolean }): string {
  if (args.stimulus) return 'this design';
  try {
    const host = new URL(
      args.targetUrl.startsWith('http') ? args.targetUrl : `https://${args.targetUrl}`
    ).hostname.replace(/^www\./, '');
    if (host) return host;
  } catch {
    // Fall through.
  }
  return 'this product';
}

// ---------------------------------------------------------------------------
// One participant's answers
// ---------------------------------------------------------------------------

export type UsabilityRating = {
  item: UsabilityItemId;
  /** 1 (strongly disagree) to 7 (strongly agree). */
  rating: number;
  /** Why, in the participant's words. */
  reason: string | null;
};

/** Stored on `interview_participants.usability` and in round snapshots. */
export type UsabilityResponse = {
  scale: UsabilityInstrument;
  ratings: UsabilityRating[];
  answered_at: string | null;
};

function isItemId(value: unknown): value is UsabilityItemId {
  return UMUX_ITEMS.some((i) => i.id === value);
}

function clampRating(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(RATING_MAX, Math.max(RATING_MIN, Math.round(value)));
}

/**
 * Reads a stored response, or null when there is nothing scoreable. Ratings
 * are clamped to the scale, items the scale does not ask are dropped, and a
 * repeated item keeps its last answer, so a hand-edited row cannot produce a
 * score outside 0 to 100.
 */
export function normaliseUsabilityResponse(value: unknown): UsabilityResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const scale = normaliseUsabilityScale(raw.scale);
  if (scale === 'none') return null;
  const asked = new Set(usabilityItems(scale).map((i) => i.id));
  const byItem = new Map<UsabilityItemId, UsabilityRating>();
  for (const entry of Array.isArray(raw.ratings) ? raw.ratings : []) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    if (!isItemId(r.item) || !asked.has(r.item)) continue;
    const rating = clampRating(r.rating);
    if (rating === null) continue;
    const reason = typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : null;
    byItem.set(r.item, { item: r.item, rating, reason });
  }
  if (byItem.size === 0) return null;
  const ratings = usabilityItems(scale)
    .map((i) => byItem.get(i.id))
    .filter((r): r is UsabilityRating => Boolean(r));
  return {
    scale,
    ratings,
    answered_at: typeof raw.answered_at === 'string' ? raw.answered_at : null,
  };
}

/** One item's contribution, 0 to 6, with negative items reversed. */
export function itemContribution(item: UsabilityItemId, rating: number): number {
  const def = UMUX_ITEMS.find((i) => i.id === item);
  const r = clampRating(rating) ?? RATING_MIN;
  return def?.tone === 'negative' ? RATING_MAX - r : r - RATING_MIN;
}

export type UsabilityScore = {
  scale: UsabilityInstrument;
  /** The instrument's own 0 to 100 score. */
  raw: number;
  /** On the SUS scale, which is what grades and benchmarks are read against. */
  susEquivalent: number;
};

/** Converts a raw UMUX-Lite score to the SUS scale (Lewis et al., 2013). */
export function umuxLiteToSus(raw: number): number {
  return 0.65 * raw + 22.9;
}

/**
 * Scores one response, or null when it is incomplete: an unanswered item
 * cannot be scored without inventing an answer for it.
 */
export function scoreUsabilityResponse(response: UsabilityResponse): UsabilityScore | null {
  const items = usabilityItems(response.scale);
  if (items.length === 0) return null;
  const byItem = new Map(response.ratings.map((r) => [r.item, r.rating]));
  if (items.some((i) => !byItem.has(i.id))) return null;
  const sum = items.reduce((n, i) => n + itemContribution(i.id, byItem.get(i.id)!), 0);
  const raw = (sum / (items.length * (RATING_MAX - RATING_MIN))) * 100;
  return {
    scale: response.scale,
    raw,
    susEquivalent: response.scale === 'umux_lite' ? umuxLiteToSus(raw) : raw,
  };
}

// ---------------------------------------------------------------------------
// Grades and benchmarks
// ---------------------------------------------------------------------------

export type UsabilityGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';

/** Sauro-Lewis curved grading scale, lower bound of each grade. */
const GRADE_FLOORS: ReadonlyArray<[UsabilityGrade, number]> = [
  ['A+', 84.1],
  ['A', 80.8],
  ['A-', 78.9],
  ['B+', 77.2],
  ['B', 74.1],
  ['B-', 72.6],
  ['C+', 71.1],
  ['C', 65.0],
  ['C-', 62.7],
  ['D', 51.7],
  ['F', 0],
];

/** The long-run average SUS score, the centre of the grading curve. */
export const SUS_BENCHMARK_MEAN = 68;

/** Grade for a score on the SUS scale. */
export function usabilityGrade(susEquivalent: number): UsabilityGrade {
  // Grades are read off scores to one decimal place, as published.
  const score = Math.round(susEquivalent * 10) / 10;
  for (const [grade, floor] of GRADE_FLOORS) {
    if (score >= floor) return grade;
  }
  return 'F';
}

export type UsabilityBand = 'excellent' | 'good' | 'ok' | 'poor';

/** A plain-language reading of a grade, for colour and copy. */
export function usabilityBand(grade: UsabilityGrade): UsabilityBand {
  if (grade.startsWith('A')) return 'excellent';
  if (grade.startsWith('B')) return 'good';
  if (grade.startsWith('C')) return 'ok';
  return 'poor';
}

export const USABILITY_BAND_LABELS: Record<UsabilityBand, string> = {
  excellent: 'Excellent',
  good: 'Good',
  ok: 'About average',
  poor: 'Below average',
};

// ---------------------------------------------------------------------------
// A round's answers together
// ---------------------------------------------------------------------------

/** Two-sided 95% critical values of Student's t, indexed by degrees of freedom. */
const T_95: readonly number[] = [
  Number.NaN,
  12.706,
  4.303,
  3.182,
  2.776,
  2.571,
  2.447,
  2.365,
  2.306,
  2.262,
  2.228,
  2.201,
  2.179,
  2.16,
  2.145,
  2.131,
  2.12,
  2.11,
  2.101,
  2.093,
  2.086,
  2.08,
  2.074,
  2.069,
  2.064,
  2.06,
  2.056,
  2.052,
  2.048,
  2.045,
  2.042,
];

function tCritical95(df: number): number {
  if (df < 1) return Number.NaN;
  if (df < T_95.length) return T_95[df]!;
  // Past the table, each bucket takes the value at its lower bound, so the
  // interval errs wide rather than narrow.
  if (df <= 40) return 2.042;
  if (df <= 60) return 2.021;
  if (df <= 120) return 2.0;
  return 1.98;
}

export type ItemSummary = {
  item: UsabilityItemId;
  label: string;
  tone: 'positive' | 'negative';
  /** Mean rating, 1 to 7, as answered (not reversed). */
  meanRating: number;
  /** Mean contribution on a 0 to 100 scale, reversed for negative items. */
  meanScore: number;
  /** How many participants gave each rating, index 0 being a rating of 1. */
  distribution: number[];
  responses: number;
};

export type UsabilitySummary = {
  scale: UsabilityInstrument;
  /** Participants whose answers could be scored. */
  respondents: number;
  /** Participants who answered but left a statement out. */
  incomplete: number;
  /** Mean raw score, on the instrument's own scale. */
  meanRaw: number;
  /** Mean on the SUS scale. */
  mean: number;
  /** Sample standard deviation on the SUS scale, null under two respondents. */
  sd: number | null;
  /** 95% confidence interval on the SUS scale, clamped to 0 to 100. */
  ci95: { low: number; high: number } | null;
  min: number;
  max: number;
  grade: UsabilityGrade;
  band: UsabilityBand;
  /** Points above (positive) or below the SUS benchmark of 68. */
  vsBenchmark: number;
  items: ItemSummary[];
};

/**
 * Summarises a round's responses on one scale. Responses on a different scale
 * (a round where the setting changed partway through cannot happen, but a
 * hand-edited row can) are ignored, and null comes back when nobody could be
 * scored.
 */
export function summariseUsability(
  scale: UsabilityInstrument,
  responses: ReadonlyArray<UsabilityResponse | null | undefined>
): UsabilitySummary | null {
  const onScale = responses.filter((r): r is UsabilityResponse => r?.scale === scale);
  const scored = onScale
    .map((r) => ({ response: r, score: scoreUsabilityResponse(r) }))
    .filter((s): s is { response: UsabilityResponse; score: UsabilityScore } => s.score !== null);
  if (scored.length === 0) return null;

  const n = scored.length;
  const values = scored.map((s) => s.score.susEquivalent);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const meanRaw = scored.reduce((a, s) => a + s.score.raw, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : null;
  const ci95 =
    sd !== null
      ? (() => {
          const margin = (tCritical95(n - 1) * sd) / Math.sqrt(n);
          return { low: Math.max(0, mean - margin), high: Math.min(100, mean + margin) };
        })()
      : null;
  const grade = usabilityGrade(mean);

  const items: ItemSummary[] = usabilityItems(scale).map((def) => {
    const ratings = scored
      .map((s) => s.response.ratings.find((r) => r.item === def.id)?.rating)
      .filter((r): r is number => typeof r === 'number');
    const distribution = Array.from({ length: RATING_MAX }, () => 0);
    for (const r of ratings) distribution[r - RATING_MIN]! += 1;
    const count = ratings.length || 1;
    return {
      item: def.id,
      label: def.label,
      tone: def.tone,
      meanRating: ratings.reduce((a, b) => a + b, 0) / count,
      meanScore:
        (ratings.reduce((a, r) => a + itemContribution(def.id, r), 0) /
          count /
          (RATING_MAX - RATING_MIN)) *
        100,
      distribution,
      responses: ratings.length,
    };
  });

  return {
    scale,
    respondents: n,
    incomplete: onScale.length - n,
    meanRaw,
    mean,
    sd,
    ci95,
    min: Math.min(...values),
    max: Math.max(...values),
    grade,
    band: usabilityBand(grade),
    vsBenchmark: mean - SUS_BENCHMARK_MEAN,
    items,
  };
}

/** The scale most responses were given on, or null when there are none. */
export function dominantUsabilityScale(
  responses: ReadonlyArray<UsabilityResponse | null | undefined>
): UsabilityInstrument | null {
  let umux = 0;
  let lite = 0;
  for (const r of responses) {
    if (r?.scale === 'umux') umux += 1;
    else if (r?.scale === 'umux_lite') lite += 1;
  }
  if (umux === 0 && lite === 0) return null;
  return umux >= lite ? 'umux' : 'umux_lite';
}

/** Rounded for display: one decimal place, never `-0.0`. */
export function formatUsabilityScore(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}
