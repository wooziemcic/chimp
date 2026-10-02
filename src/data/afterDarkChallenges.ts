/**
 * Phase 7A: After Dark Challenges — short dating games two people in a Vibe
 * play together. Each person answers on their own; nothing is revealed until
 * both have answered (the server enforces that for REAL accounts). Answers
 * are option numbers, so a deck's wording can be polished without breaking
 * old results. No public leaderboards; results belong to the pair.
 */
export type ChallengeKind = 'same_brain' | 'would_you_rather' | 'predict_me' | 'choose_the_night' | 'fast_five' | 'after_hours' | 'two_truths';

/**
 * Phase 7B: Two Truths and a Lie. The sender writes three statements (free
 * text, 1–120 characters each, cleaned on the server) and marks the lie; the
 * other person guesses. Which one was the lie stays hidden until they've
 * guessed (the same rule as every challenge: answers show once both played).
 */
export const TWO_TRUTHS = { kind: 'two_truths' as const, deck: 'tt', maxLength: 120 };

export interface ChallengeQuestion {
  q: string;
  options: string[];
}

export interface ChallengeDeck {
  id: string;
  questions: ChallengeQuestion[];
}

export interface ChallengeType {
  kind: ChallengeKind;
  title: string;
  emoji: string;
  /** One line on the card. */
  blurb: string;
  /** Default note when you send it. */
  invite: string;
  /** How the result reads: matches, (Predict Me) correct guesses, or (Two Truths) was the lie spotted. */
  scoring: 'match' | 'predict' | 'lie';
  decks: ChallengeDeck[];
}

export const CHALLENGES: ChallengeType[] = [
  {
    kind: 'same_brain',
    title: 'Same Brain',
    emoji: '⚡',
    blurb: 'Five quick picks. See how often you think alike.',
    invite: 'Let’s see if we actually think alike.',
    scoring: 'match',
    decks: [
      {
        id: 'sb1',
        questions: [
          { q: 'Friday night', options: ['Out out', 'Dinner and a walk', 'Couch and a film'] },
          { q: 'Trip style', options: ['Plan everything', 'Book a flight, wing it'] },
          { q: 'Coffee order', options: ['Espresso', 'Oat latte', 'Anything iced'] },
          { q: 'Texting', options: ['Voice notes', 'Long paragraphs', 'One word at a time'] },
          { q: 'First date', options: ['Drinks', 'Food', 'Something to do'] },
        ],
      },
      {
        id: 'sb2',
        questions: [
          { q: 'Morning or night', options: ['Sunrise person', 'Night owl'] },
          { q: 'Live music', options: ['Big stadium', 'Tiny venue'] },
          { q: 'Sunday', options: ['Brunch', 'Long run', 'Sleep till noon'] },
          { q: 'Road trip', options: ['Driver', 'DJ', 'Snacks'] },
          { q: 'Dessert', options: ['Always', 'Never', 'Steal a bite of yours'] },
        ],
      },
    ],
  },
  {
    kind: 'would_you_rather',
    title: 'Would You Rather',
    emoji: '🤔',
    blurb: 'Hard choices, honest answers.',
    invite: 'Answer honestly. I will too.',
    scoring: 'match',
    decks: [
      {
        id: 'wyr1',
        questions: [
          { q: 'Would you rather…', options: ['Weekend in Paris', 'Weekend in Tokyo'] },
          { q: 'Would you rather…', options: ['Always early', 'Always 10 minutes late'] },
          { q: 'Would you rather…', options: ['Cook together', 'Get cooked for'] },
          { q: 'Would you rather…', options: ['Karaoke', 'Dance floor'] },
        ],
      },
    ],
  },
  {
    kind: 'predict_me',
    title: 'Predict Me',
    emoji: '🔮',
    blurb: 'The sender answers about themselves. You guess what they picked.',
    invite: 'How well do you think you know me already?',
    scoring: 'predict',
    decks: [
      {
        id: 'pm1',
        questions: [
          { q: 'My go-to order at a bar', options: ['Cocktail', 'Beer', 'Wine', 'Mocktail'] },
          { q: 'My ideal vacation', options: ['Beach', 'City', 'Mountains'] },
          { q: 'I’m usually the one who…', options: ['Plans', 'Says yes', 'Brings snacks'] },
          { q: 'My comfort show is…', options: ['A sitcom', 'A crime doc', 'Reality TV'] },
        ],
      },
    ],
  },
  {
    kind: 'choose_the_night',
    title: 'Choose the Night',
    emoji: '🌙',
    blurb: 'Build a night out together, one choice at a time.',
    invite: 'Let’s design a night. Then maybe do it.',
    scoring: 'match',
    decks: [
      {
        id: 'ctn1',
        questions: [
          { q: 'Start with', options: ['Rooftop drinks', 'Wine bar', 'Gallery opening'] },
          { q: 'Then', options: ['Tacos', 'Ramen', 'Something fancy'] },
          { q: 'Then', options: ['Live music', 'Comedy show', 'Long walk'] },
          { q: 'End with', options: ['Late-night dessert', 'Karaoke', 'Call it early'] },
        ],
      },
    ],
  },
  {
    kind: 'fast_five',
    title: 'Fast Five',
    emoji: '⏱️',
    blurb: 'Five snap answers. Don’t overthink it.',
    invite: 'Go fast. First instinct only.',
    scoring: 'match',
    decks: [
      {
        id: 'ff1',
        questions: [
          { q: 'Cats or dogs', options: ['Cats', 'Dogs'] },
          { q: 'Beach or snow', options: ['Beach', 'Snow'] },
          { q: 'Call or text', options: ['Call', 'Text'] },
          { q: 'Sweet or salty', options: ['Sweet', 'Salty'] },
          { q: 'Plans or spontaneity', options: ['Plans', 'Spontaneity'] },
        ],
      },
    ],
  },
  {
    kind: 'after_hours',
    title: 'After Hours',
    emoji: '🍸',
    blurb: 'A little flirtier. Still never explicit.',
    invite: 'Late-night questions. Be honest.',
    scoring: 'match',
    decks: [
      {
        id: 'ah1',
        questions: [
          { q: 'Best part of a first date', options: ['The nerves', 'The first laugh', 'The walk after'] },
          { q: 'Most attractive', options: ['Confidence', 'Kindness', 'Being funny'] },
          { q: 'Slow dance or dance floor', options: ['Slow dance', 'Dance floor'] },
          { q: 'Second date', options: ['Same night, new place', 'A week later', 'Whenever it feels right'] },
        ],
      },
    ],
  },
  {
    kind: 'two_truths',
    title: 'Two Truths',
    emoji: '🎭',
    blurb: 'Write two truths and a lie. They guess the lie.',
    invite: 'Spot the lie.',
    scoring: 'lie',
    // Written by the sender, not a deck.
    decks: [{ id: 'tt', questions: [] }],
  },
];

export const challengeType = (kind: string): ChallengeType | undefined => CHALLENGES.find((c) => c.kind === kind);
export const challengeDeck = (kind: string, deck: string): ChallengeDeck | undefined => challengeType(kind)?.decks.find((d) => d.id === deck);

/** Pair result: how many answers matched (or, for Predict Me, were guessed right). */
export function challengeScore(a: number[] | undefined, b: number[] | undefined): { same: number; total: number } {
  if (!a || !b) return { same: 0, total: Math.max(a?.length ?? 0, b?.length ?? 0) };
  const total = Math.min(a.length, b.length);
  let same = 0;
  for (let i = 0; i < total; i++) if (a[i] === b[i]) same++;
  return { same, total };
}

/** "4 of 5 the same" / "3 of 4 guessed right" / (Two Truths) was the lie spotted — pair-level, never ranked. */
export function resultLine(c: { kind: string }, mine?: number[], theirs?: number[]): string {
  // Two Truths: one answer each — the lie (sender) and the guess.
  if (c.kind === 'two_truths') return mine?.[0] != null && mine[0] === theirs?.[0] ? 'The lie was spotted' : 'The lie got through';
  const r = challengeScore(mine, theirs);
  return challengeType(c.kind)?.scoring === 'predict' ? `${r.same} of ${r.total} guessed right` : `${r.same} of ${r.total} the same`;
}
