/**
 * One interface for chat, two implementations:
 *   realChatApi  → Supabase (services/backend/chat.ts), REAL accounts
 *   demoChatApi  → in memory (services/demoChat.ts), the Demo account
 * The chat store talks only to this, so REAL and Demo can never mix.
 */
import * as chat from '@/services/backend/chat';
import { mediaUrl } from '@/lib/supabase';
import { MAX_EDGE, type PickedImage, prepareImage, uploadAudio, uploadImage, uploadPrivateImage } from '@/services/backend/media';

export interface ChatApi {
  demo: boolean;
  fetchConversations: typeof chat.fetchConversations;
  fetchMessages: typeof chat.fetchMessages;
  sendMessage: typeof chat.sendMessage;
  markRead: typeof chat.markRead;
  /** Phase 8 (0011): Seen up to a message, Delivered after a sync, and the receipts to show. */
  markReadUpto: typeof chat.markReadUpto;
  markDelivered: typeof chat.markDelivered;
  fetchReceipts: typeof chat.fetchReceipts;
  respondToRequest: typeof chat.respondToRequest;
  startConversation: typeof chat.startConversation;
  deleteMessage: typeof chat.deleteMessage;
  mediaUrls: typeof chat.mediaUrls;
  createGroup: typeof chat.createGroup;
  updateGroup: typeof chat.updateGroup;
  addGroupMembers: typeof chat.addGroupMembers;
  removeGroupMember: typeof chat.removeGroupMember;
  setGroupRole: typeof chat.setGroupRole;
  leaveGroup: typeof chat.leaveGroup;
  deleteGroup: typeof chat.deleteGroup;
  fetchMembers: typeof chat.fetchMembers;
  fetchReactions: typeof chat.fetchReactions;
  react: typeof chat.react;
  fetchSameBrain: typeof chat.fetchSameBrain;
  sendPing: typeof chat.sendPing;
  fetchMyPings: typeof chat.fetchMyPings;
  cancelPing: typeof chat.cancelPing;
  fetchPingMatches: typeof chat.fetchPingMatches;
  fetchLoops: typeof chat.fetchLoops;
  createLoop: typeof chat.createLoop;
  updateLoop: typeof chat.updateLoop;
  deleteLoop: typeof chat.deleteLoop;
  subscribeInbox: typeof chat.subscribeInbox;
  subscribeConversation: typeof chat.subscribeConversation;
  /** Phase 7A: open a view-once photo (recipient, once). */
  openViewOnce: typeof chat.openViewOnce;
  /** Phase 7B: is view-once set up (REAL: the server function is deployed)? null = couldn't tell. */
  viewOnceAvailable: typeof chat.viewOnceAvailable;
  /** Phase 7A: a voice note: uploaded (REAL) or kept on the phone (Demo). */
  uploadAudio: (uid: string, uri: string, durationMs: number) => Promise<{ id: string; url: string }>;
  /** A chat photo / group photo: uploaded (REAL) or kept on the phone (Demo). */
  /** `private`: a view-once photo (Phase 7B: the private bucket; `url` is empty). */
  uploadPhoto: (uid: string, img: PickedImage, opts?: { private?: boolean }) => Promise<{ id: string; url: string; aspect?: number }>;
  /** Group photo path → URL. */
  avatarUrl: (path: string | null | undefined) => string | undefined;
}

export const realChatApi: ChatApi = {
  demo: false,
  ...chat,
  uploadPhoto: async (uid, img, opts) => {
    const prepared = await prepareImage(img, MAX_EDGE.post);
    const up = opts?.private ? await uploadPrivateImage(uid, prepared) : await uploadImage(uid, 'chat', prepared);
    return { id: up.id, url: up.url, aspect: up.width && up.height ? up.width / up.height : undefined };
  },
  uploadAudio: async (uid, uri, durationMs) => {
    const up = await uploadAudio(uid, uri, durationMs);
    return { id: up.id, url: up.url };
  },
  avatarUrl: (path) => (path ? (/^https?:|^file:|^blob:|^data:/.test(path) ? path : mediaUrl(path)) : undefined),
};
