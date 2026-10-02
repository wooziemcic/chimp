/**
 * Phase 7A: one After Dark interface, two implementations (like chatApi.ts):
 *   realAfterDarkApi → Supabase (services/backend/afterDark.ts), REAL accounts
 *   demoAfterDarkApi → in memory (services/demoAfterDark.ts), the Demo account
 * The After Dark store talks only to this, so REAL and Demo never mix.
 */
import * as ad from '@/services/backend/afterDark';
import { MAX_EDGE, type PickedImage, prepareImage, uploadImage } from '@/services/backend/media';

export interface AfterDarkApi {
  demo: boolean;
  fetchMyProfile: typeof ad.fetchMyAdProfile;
  saveProfile: typeof ad.saveAdProfile;
  discover: typeof ad.discover;
  pass: typeof ad.pass;
  myVibes: typeof ad.myVibes;
  requestVibe: typeof ad.requestVibe;
  respondVibe: typeof ad.respondVibe;
  pauseVibe: typeof ad.pauseVibe;
  resumeVibe: typeof ad.resumeVibe;
  endVibe: typeof ad.endVibe;
  setVibeControls: typeof ad.setVibeControls;
  canSendInVibe: typeof ad.canSendInVibe;
  fetchChallenges: typeof ad.fetchChallenges;
  fetchAnswers: typeof ad.fetchAnswers;
  sendChallenge: typeof ad.sendChallenge;
  answerChallenge: typeof ad.answerChallenge;
  sendTwoTruths: typeof ad.sendTwoTruths;
  fetchVibeLoops: typeof ad.fetchVibeLoops;
  report: typeof ad.report;
  subscribe: typeof ad.subscribeAfterDark;
  /** A card photo: uploaded to afterdark/{you}/ (REAL) or kept on the phone (Demo). Returns its path. */
  uploadCardPhoto: (uid: string, img: PickedImage) => Promise<string>;
  photoUrl: (path: string | null | undefined) => string | undefined;
}

export const realAfterDarkApi: AfterDarkApi = {
  demo: false,
  fetchMyProfile: ad.fetchMyAdProfile,
  saveProfile: ad.saveAdProfile,
  discover: ad.discover,
  pass: ad.pass,
  myVibes: ad.myVibes,
  requestVibe: ad.requestVibe,
  respondVibe: ad.respondVibe,
  pauseVibe: ad.pauseVibe,
  resumeVibe: ad.resumeVibe,
  endVibe: ad.endVibe,
  setVibeControls: ad.setVibeControls,
  canSendInVibe: ad.canSendInVibe,
  fetchChallenges: ad.fetchChallenges,
  fetchAnswers: ad.fetchAnswers,
  sendChallenge: ad.sendChallenge,
  answerChallenge: ad.answerChallenge,
  sendTwoTruths: ad.sendTwoTruths,
  fetchVibeLoops: ad.fetchVibeLoops,
  report: ad.report,
  subscribe: ad.subscribeAfterDark,
  uploadCardPhoto: async (uid, img) => (await uploadImage(uid, 'afterdark', await prepareImage(img, MAX_EDGE.post))).path,
  photoUrl: ad.photoUrl,
};
