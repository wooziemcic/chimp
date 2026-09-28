/**
 * One interface for chat, two implementations:
 *   realChatApi  → Supabase (services/backend/chat.ts), REAL accounts
 *   demoChatApi  → in memory (services/demoChat.ts), the Demo account
 * The chat store talks only to this, so REAL and Demo can never mix.
 */
import * as chat from '@/services/backend/chat';
import { mediaUrl } from '@/lib/supabase';
import { MAX_EDGE, type PickedImage, prepareImage, uploadImage } from '@/services/backend/media';

export interface ChatApi {
  demo: boolean;
  fetchConversations: typeof chat.fetchConversations;
  fetchMessages: typeof chat.fetchMessages;
  sendMessage: typeof chat.sendMessage;
  markRead: typeof chat.markRead;
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
  /** A chat photo / group photo: uploaded (REAL) or kept on the phone (Demo). */
  uploadPhoto: (uid: string, img: PickedImage) => Promise<{ id: string; url: string; aspect?: number }>;
  /** Group photo path → URL. */
  avatarUrl: (path: string | null | undefined) => string | undefined;
}

export const realChatApi: ChatApi = {
  demo: false,
  ...chat,
  uploadPhoto: async (uid, img) => {
    const up = await uploadImage(uid, 'chat', await prepareImage(img, MAX_EDGE.post));
    return { id: up.id, url: up.url, aspect: up.width && up.height ? up.width / up.height : undefined };
  },
  avatarUrl: (path) => (path ? (/^https?:|^file:|^blob:|^data:/.test(path) ? path : mediaUrl(path)) : undefined),
};
