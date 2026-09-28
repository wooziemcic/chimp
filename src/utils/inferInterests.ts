/**
 * Phase 6B: a Buzz posted without a World still feeds the graph. Its interests
 * are inferred from the words in it (interest labels + a few common synonyms).
 * Deterministic and cheap; never includes After Dark interests.
 */
import { INTERESTS } from '@/data/interests';

const SYNONYMS: [RegExp, string][] = [
  [/\b(cinema|movie|movies|film|films|director|oscar|trailer|netflix)\b/i, 'i_film'],
  [/\b(food|ramen|pizza|brunch|dinner|restaurant|coffee|recipe|eat|tacos?)\b/i, 'i_food'],
  [/\b(photo|photos|camera|shot|lens|35mm|portrait)\b/i, 'i_photo'],
  [/\b(trip|travel|flight|road ?trip|airport|hotel|niagara|beach|hike|hiking)\b/i, 'i_travel'],
  [/\b(tokyo|kyoto|osaka|japan)\b/i, 'i_japan'],
  [/\b(startup|founder|founders|seed round|yc|pitch)\b/i, 'i_startups'],
  [/\b(ai|llm|gpt|claude|machine learning)\b/i, 'i_ai'],
  [/\b(song|album|concert|gig|playlist|music)\b/i, 'i_music'],
  [/\b(game|gaming|playstation|xbox|nintendo)\b/i, 'i_gaming'],
  [/\b(book|books|novel|reading)\b/i, 'i_books'],
  [/\b(gym|run|running|workout|marathon|fitness)\b/i, 'i_fitness'],
  [/\b(nba|nfl|soccer|football|match|goal|sports?)\b/i, 'i_sports'],
  [/\b(outfit|fit|style|fashion|sneakers)\b/i, 'i_style'],
  [/\b(space|nasa|physics|science)\b/i, 'i_science'],
];

export function inferInterestsFromText(text: string | undefined | null): string[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const out = new Set<string>();
  for (const i of INTERESTS) if (i.category !== 'afterDark' && t.includes(i.label.toLowerCase())) out.add(i.id);
  for (const [re, id] of SYNONYMS) if (re.test(text)) out.add(id);
  return [...out].slice(0, 3);
}
