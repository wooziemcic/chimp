/**
 * The reproducible Phase 5 demo path: seven actions, one Opportunity Graph,
 * consequences on every normal surface (Boards, a World's Today edition,
 * Drift, Buzz, Happening, You, the Agent). Graph Debug can run it step by
 * step or all at once. Phase 4's demo is superseded (see README).
 */
import type { ChimpState } from '@/store/useChimp';

export interface DemoStep {
  id: string;
  label: string;
  /** Which surface to look at afterwards. */
  surface: string;
  done: (s: ChimpState) => boolean;
  run: (s: ChimpState) => void;
}

/** Items the demo uses (all seeded; all Japan except the disliked Style post). */
export const DEMO_IDS = {
  board: 'japan-trip',
  driftJapan: 'dr_ninenzaka',
  buzzJapan: 'bz_kyoto_early',
  postJapan: 'p_kyoto_route',
  branch: 'h_japan',
  person: 'u_maya_t',
  buzzUnrelated: 'bz_same_fit',
};

export const DEMO_STEPS: DemoStep[] = [
  { id: 'open', label: 'Open the Japan Trip Board', surface: 'Boards', done: (s) => !!s.boardVisits[DEMO_IDS.board], run: (s) => s.visitBoard(DEMO_IDS.board) },
  { id: 'watch', label: 'Watch a Japan Drift video (Ninenzaka)', surface: 'Drift', done: (s) => !!s.driftViews[DEMO_IDS.driftJapan], run: (s) => s.watchDrift(DEMO_IDS.driftJapan) },
  { id: 'like', label: 'Like a Japan Buzz post (Maya, Kyoto)', surface: 'Buzz', done: (s) => !!s.buzzLikes[DEMO_IDS.buzzJapan], run: (s) => s.toggleBuzzLike(DEMO_IDS.buzzJapan) },
  { id: 'save', label: 'Save the Kyoto Temple Walk (Japan Trip)', surface: 'Japan Trip · Today', done: (s) => !!s.savedPosts[DEMO_IDS.postJapan], run: (s) => s.toggleSavePost(DEMO_IDS.postJapan) },
  {
    id: 'explore',
    label: 'Explore the Japan branch in Happening',
    surface: 'Happening',
    done: (s) => !!s.exploredNodes[DEMO_IDS.branch],
    run: (s) => s.exploreBranch(DEMO_IDS.branch, { kind: 'interest', id: 'i_japan' }),
  },
  { id: 'follow', label: 'Follow Maya Tanaka', surface: 'You', done: (s) => !!s.following[DEMO_IDS.person], run: (s) => s.toggleFollow(DEMO_IDS.person) },
  { id: 'dislike', label: 'Dislike an unrelated Style Buzz post', surface: 'Buzz', done: (s) => !!s.buzzDislikes[DEMO_IDS.buzzUnrelated], run: (s) => s.toggleBuzzDislike(DEMO_IDS.buzzUnrelated) },
];
