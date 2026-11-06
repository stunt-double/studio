// What the actor reads during a local interview: its brief, each item of the
// guide in turn, and the usability questionnaire at the end. The answers are
// the person's own agent speaking in character, so nothing here calls a model.

import { personaBlocks } from './brief.ts';
import type { Actor, Interview, InterviewRun } from './files.ts';
import {
  formatUsabilityScore,
  normaliseUsabilityResponse,
  productNameFor,
  RATING_ANCHORS,
  scoreUsabilityResponse,
  USABILITY_BAND_LABELS,
  USABILITY_SCALE_LABELS,
  usabilityBand,
  usabilityGrade,
  usabilityItems,
  usabilityStatement,
  type UsabilityInstrument,
  type UsabilityScore,
} from './vendor/usability/usability.ts';

export type GuideItem = {
  section: number;
  item: number;
  title: string;
  intro: string | undefined;
  type: 'question' | 'task';
  prompt: string;
};

/** Every item of the guide, in the order it is asked. */
export function guideItems(interview: Pick<Interview, 'sections'>): GuideItem[] {
  return interview.sections.flatMap((section, s) =>
    section.items.map((item, i) => ({
      section: s,
      item: i,
      title: section.title,
      intro: section.intro,
      type: item.type,
      prompt: item.prompt,
    }))
  );
}

/** What the statements call the product: the site's host, as a participant would. */
export const productName = (url: string): string =>
  productNameFor({ targetUrl: url, stimulus: false });

export function buildInterviewBrief(input: {
  actor: Actor;
  interview: Interview;
  /** Where the browser starts: the interview's URL, or its local rebase. */
  start: string;
  /** Items answered before a resume; 0 for a new interview. */
  answered: number;
}): string {
  const { actor, interview, start, answered } = input;
  const total = guideItems(interview).length;
  const questionnaire =
    interview.usability_scale === 'none'
      ? ''
      : `- After the last item you rate ${usabilityItems(interview.usability_scale).length} statements about the product with rate_usability, in character, each with a reason.`;
  // The research brief is the researcher's purpose, so the participant is not
  // shown it: knowing what is being looked for colours the answers.
  return [
    ...personaBlocks(actor),
    // Named from the interview's own URL, as the cloud does, never `localhost`.
    `You are taking part in a research interview about ${productName(interview.url)}, starting at ${start}${answered ? ` (it is resuming: your ${answered} earlier answers stand)` : ''}. There are ${total} items.`,
    [
      'How to take part:',
      '- Stay in character: answer as this person would, in the first person and in their own words, not as a tester or a reviewer.',
      '- A question: answer it from what you have seen of the product so far, and look at it in the browser first when you need to.',
      '- A task: do it in the browser as this person would, then answer with what happened and how it went for you. If you get stuck, say where and stop trying.',
      '- Record each answer with answer_item as soon as you have it. It returns the next item.',
      '- Read the page with read_page and find. Ask for a screenshot only when how something looks is the question.',
      questionnaire,
      '- Always end with finish_interview and a one or two sentence summary of how it went, even when stopped.',
    ]
      .filter(Boolean)
      .join('\n'),
  ].join('\n\n');
}

/** One item, as the actor is asked it. */
export function itemText(item: GuideItem, index: number, total: number): string {
  const intro = item.item === 0 && item.intro ? `\n${item.intro}` : '';
  const kind = item.type === 'task' ? 'Task' : 'Question';
  return `Item ${index + 1} of ${total}, in "${item.title}":${intro}\n${kind}: ${item.prompt}`;
}

/** The questionnaire, with each statement's id, naming the product from the interview's URL. */
export function questionnaireText(scale: UsabilityInstrument, url: string): string {
  const product = productName(url);
  const statements = usabilityItems(scale).map(
    (item) => `- ${item.id}: "${usabilityStatement(item, product)}"`
  );
  const anchors = RATING_ANCHORS.map((a, i) => `${i + 1} ${a}`).join(', ');
  return [
    `Every item has an answer. Now, still in character, rate how much you agree with each statement, from 1 to 7 (${anchors}), and say why in a sentence. Record all ${statements.length} with rate_usability:`,
    statements.join('\n'),
  ].join('\n');
}

/** A session's usability score, when it has a complete response. */
export function scoreInterview(
  run: Pick<InterviewRun, 'usability'>
): (UsabilityScore & { grade: string; band: string }) | null {
  // Read as the cloud reads a stored row, so a hand-edited file scores as it would there.
  const response = normaliseUsabilityResponse(run.usability);
  const score = response && scoreUsabilityResponse(response);
  if (!score) return null;
  const grade = usabilityGrade(score.susEquivalent);
  return { ...score, grade, band: USABILITY_BAND_LABELS[usabilityBand(grade)] };
}

/** `UMUX 75.0, grade B (Good)`, or for UMUX-Lite with its SUS equivalent. */
export function describeScore(score: NonNullable<ReturnType<typeof scoreInterview>>): string {
  const label = USABILITY_SCALE_LABELS[score.scale];
  const sus =
    score.scale === 'umux_lite'
      ? ` (${formatUsabilityScore(score.susEquivalent)} on the SUS scale)`
      : '';
  return `${label} ${formatUsabilityScore(score.raw)}${sus}, grade ${score.grade} (${score.band})`;
}
