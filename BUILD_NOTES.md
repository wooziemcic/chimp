# Chimp build notes — v0.8 — Device Reliability, Responsive iOS System, Messaging v2, Posting Reliability, Content Ordering

5 Oct 2026 · branch `phase-7` (on top of `ea2961a`).

I made no commits or pushes, did not merge `master`, and started no EAS build or TestFlight submission. I didn't modify migrations 0001–0010; the only new one is `0011_phase8_device_messaging.sql`. Opportunity Graph v2 was not touched.

> **Status: implemented and tested locally. Not yet run on an iPhone or against your Supabase project.**
> - **How it was tested:** a local Postgres 16 with a Supabase stub; Node tests against the real app modules; and a web build in Chromium with each iPhone family's safe-area insets **simulated**.
> - **iPhone results:** none yet. Nothing in this document is an iPhone result. The real-device checklist at the end is what closes Phase 8.
> - **Device labels:** they come from Apple's published point sizes and insets per family. Treat them as approximate.

## What you must do once

1. **Supabase → SQL Editor:** run `supabase/migrations/0011_phase8_device_messaging.sql`.
   - It checks that 0010 is there.
   - It runs as one transaction and is safe to run twice.
   - RLS stays on.
2. **Install the new packages:** run `npm install` in the project folder. `package.json` and `package-lock.json` changed.
   - New: `expo-camera` (record video in Chimp), `expo-media-library` (save captures to Photos).
   - `expo-file-system` is now listed explicitly; it was already part of Expo.
3. **A new EAS build is required.** I didn't start one.
   - Posting reliability adds two **native** modules (`expo-camera` and `expo-media-library`) and new iOS permission texts (camera, microphone, Photos add). An OTA update can't deliver them.
   - Everything else in Phase 8 is JavaScript.
4. Nothing else changes: no new secrets, Edge Functions, webhooks or cron jobs. Posting reliability needs **no** database migration.

**If 0011 is not run:** the new app still works.
- Reading falls back to `mark_conversation_read`.
- Receipts show only "Sent", and the app never guesses "Delivered" or "Seen".
- This fallback is tested.

**If 0011 is run and people are still on Build 5:**
- Build 5 keeps working (`mark_conversation_read` is unchanged).
- Build 5 users never acknowledge delivery. People messaging them see "Sent" until they open the chat, then "Seen".

**Rollback.** Only do this if you must; it removes receipts.

```sql
begin;
drop function if exists public.chat_receipts(uuid);
drop function if exists public.mark_delivered(uuid);
drop function if exists public.mark_read_upto(uuid, uuid);
drop policy if exists "members read" on public.conversation_members;
create policy "members read" on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id));
alter table public.conversation_members drop column if exists last_delivered_at;
commit;
```

- The new app copes with the rollback: missing functions mean "Sent only".
- **Risk:** low. The migration adds one nullable column, three functions and one stricter replacement policy. Nothing is renamed or dropped.

---

## 1 · Post-Phase-7 audit (Part 1): what was patched, what was consolidated

| Area | Before | Now |
|---|---|---|
| Safe-area sources | Each screen called `useSafeAreaInsets()` / `SafeAreaView`. Full-screen viewers inside a React Native `Modal` got the App Review frame's insets (top 0) or a native `SafeAreaView` that can report 0 in a fresh iOS Modal | **One contract.** In-frame screens keep `useSafeAreaInsets()`. Anything that covers the whole phone (Modal viewers, sheets in a Modal, fullScreenModal routes) uses `useDeviceInsets()`. Those are the phone's real insets, captured at the root outside the App Review frame and never lower than the launch insets |
| Hard-coded chrome offsets | After Dark view-once viewer `top: 54`; Story/Drift `insets.top + 6`; Drift mute `insets.top + 56` | `FullscreenTopBar` / `fullscreenTop(insets)` = inset + 8, with 44-pt controls. Drift mute = `fullscreenTop + MIN_TAP + 4`. No device names, no guessed numbers |
| Board tabs | `stickyHeaderIndices` pinned the tabs at y = 0, under the status bar (the hero is edge to edge) | The in-flow tabs plus a pinned copy placed at `safeTop + 6` once the scroll reaches `pinAt(tabsY, safeTop)` |
| Nested routes that keep the bottom bar | A regex in `useLayout` | `NESTED_NAV_ROUTES = ['board','chat','group']`, the one list (theme/layout), and `keepsBottomNav()` is pure and tested |
| Pure layout rules | Inside components | `src/theme/safeArea.ts` (MIN_TAP, FULLSCREEN_GAP, PIN_GAP, `resolveDeviceInsets`, `fullscreenTop`, `pinAt`) and `src/theme/layout.ts` (nav maths, nested routes). React-free and unit-tested |

**Routes that bypass the shell, on purpose:**
- Story viewer, Drift viewer, view-once photo and the media viewer: true full screen, no tab bar.
- Compose sheets: iOS page-sheet; `CreateParts` keeps its iOS `paddingTop: 14`, which is correct for a sheet that already starts below the status bar.

**Decorative fixed numbers left as they are:** `DriftTile` (`top: 40`) and `ChatStrips` (`burstWrap`). They sit inside cards, not against device chrome.

## 2 · Responsive iOS system (Parts 2–7)

**The root causes of the two reported bugs:**
- **Close X too high on iPhone 16/17 base.**
  - The media viewer used a native `SafeAreaView` inside a React Native `Modal`, which can report top = 0 for the first frames on iOS.
  - The After Dark viewer used a fixed `top: 54`, but Dynamic Island phones have a top inset of about 59–62 pt.
  - Inside the App Review Demo, the nested safe-area provider deliberately reports top 0.
  - **Fix:** every full-screen surface now uses `useDeviceInsets()` + `FullscreenTopBar` (`src/components/system/SafeArea.tsx`).
- **Board Today / Explore / People under the status bar.**
  - `stickyHeaderIndices` pins at screen y = 0.
  - **Fix:** the tabs pin below the safe area, on the Board's background, with a hairline. The status-bar style follows the pinned state.

**What changed:**
- **Full-screen surfaces:**
  - Image and video viewer (`MediaViewer`): close is 44 × 44 with `hitSlop` 8. The caption clears the home indicator. Video fits between the top bar and the bottom inset, so it can't push controls off screen.
  - Story viewer, Drift viewer, After Dark view-once viewer and After Dark photos: the last two go through `MediaViewer` / `FullscreenTopBar`.
- **Sheets in a Modal** now use device insets for the home indicator:
  - message menu, Open Loops, Mutual Ping, the new Seen-by sheet;
  - World / owner menus, After Dark sheets.
- **App shell:**
  - The bottom bar has one source (`TabBar`, plus `NestedTabBar` on Board / chat / group routes).
  - It steps aside while the keyboard is up, and the chat composer then sits on the keyboard (`useComposerNavSpace`).
  - It is hidden only on true full-screen routes.

## 3 · Messaging v2: Sent / Delivered / Seen (Parts 8–11)

| State | Meaning (honest) | How |
|---|---|---|
| **Sent** | The server has the message | It has a server id and no local "sending" status |
| **Delivered** | The recipient's **app** synced it and told the server. A push being sent does **not** count | `mark_delivered()` after an inbox sync, or when a message arrives live and that chat isn't on screen. One call covers all chats, and only when something newer from someone else arrived |
| **Seen** | The recipient had that chat **open with the app in the foreground** at or after the message | `mark_read_upto(cid, newest message id on screen)`, debounced 300 ms. It is re-checked when it fires, and sent immediately if you leave the chat |

**Read-cursor architecture (Part 9):**
- **One cursor pair per member:** `last_read_at` (existing) and `last_delivered_at` (new).
- **Server time only.**
  - The client sends a message id, never a time. The cursor becomes that message's server `created_at`.
  - Message `created_at` is forced to `now()` for app inserts (0006 guard).
- **Monotonic and idempotent:** `greatest(old, new)`. A repeat call writes nothing, so it causes no Realtime noise.
  - Old history isn't wrongly marked: you only ever mark up to a message you actually loaded.
  - A late joiner never counts as having seen messages from before they joined.
- **Realtime:** the sender's open chat listens for member-row changes.
  - A cursor-only change refreshes just the receipts.
  - Only a real membership change (joined, left, accepted, role) reloads the members and the chat list.
- **Reconcile:** on foreground, the open chat is re-opened (messages, Seen, receipts). Each Realtime reconnect (`SUBSCRIBED`) reloads the list and the open chat.

**UI:**
- **One status line per chat,** under my newest message, and only while it's the newest message in the chat. Examples: `9:41 AM · Delivered`, `9:41 AM · Seen`.
- **Groups (Part 10):**
  - "Seen by N" or "Seen by everyone". Tap it to see who.
  - The audience is active members who were already in the group when it was sent, excluding me.
  - Names are never listed under messages.
- **Delivered in groups** shows only when everyone in that audience has it.

**After Dark (Part 11): Option D, no receipts at all, enforced by the server.**
- `chat_receipts` returns nothing for a Vibe.
- The "members read" policy hides the partner's member row inside a Vibe, so their `last_read_at` can't be queried and doesn't arrive over Realtime.
- `mark_delivered` skips Vibes.
- Reading a Vibe still moves your own cursor, so your unread count stays right.
- Why: mutual-consent, romantic context; "seen and no reply" pressure is exactly what After Dark should avoid. View-once photos keep their existing "Opened" state, which is part of the view-once feature, not a read receipt.

**Privacy rules (server-side, tested):**
- No receipts across a block, in either direction.
- No receipts from someone who hasn't accepted your request.
- None for someone who declined or left.
- Delivery cursors only move for **active** members who share **no block** with anyone in that conversation. A request recipient's or a blocker's app syncing never signals "online" to anyone.
- In a 1:1, the other person's member row is hidden from the table while their request is pending, or while either of you has blocked the other.

**Known residual (pre-existing since 0002, documented):**
- In a **group**, members can query each other's raw `last_read_at` through the table API, including across a block. The app never shows it.
- Removing it needs a client that no longer reads cursors from the table (Build 6+), followed by a column-privilege migration. Build 5 still selects `last_read_at`.

**Fixed along the way (found by the new tests):**
- **Realtime topics:** supabase-js returns the *existing* channel for a topic it already has, including one that is being removed. Closing and reopening a chat quickly, or a sign-in restart, could therefore attach listeners to a dying channel, and live updates for that chat stopped.
  - Every subscription now gets a unique topic suffix (`realtimeTopic.ts`).
- **A 1:1 chat opened while chat was still starting** (cold start, sign-in settling) lost its subscription when chat finished starting.
  - `RealChat` now opens only once chat is bound to the account, and re-opens if chat restarts. Group and Vibe screens already did this.
- **Unread counts:** a chat left open with the app in the background was zeroed. It now counts what arrives until you are actually looking at it.

## 4 · Unread counts and notifications (Parts 12–15)

**Unread (Part 12):**
- **Chat unread is the server's count** (`my_conversations`: messages from others after `last_read_at`).
  - A live message adds 1 unless you're looking at that chat in the foreground.
  - Message Requests are counted separately.
- **On sign-out or account switch, everything is cleared:**
  - chat store `stop()` clears receipts, cursors, timers and per-chat state;
  - the social inbox resets in `stopLive`;
  - After Dark `stop()`.
- **App icon badge:** none (`shouldSetBadge: false`). There is no app-icon count to go stale.

**Notifications v2 (Part 13):** the Phase 7C system is unchanged (no new system).
- Re-validated: push7 Node suite 30/30, 0009/0010 DB suites, and Build 5's follow / connection pushes.

**Notification read model (Part 14).** Decision: keep the simple model.
- Opening the bell (What changed) marks your social notifications seen after 0.8 s, and the bell dot clears.
- Per-item read state was not added: the list is short, and the dot answers "anything new?".

**Cold start and deep links (Part 15):** one pure rule, `pushGate()`, unit-tested.

| Situation | Result |
|---|---|
| Foreground or background tap, right account, chat ready | Opens the route |
| Killed, session restoring / switching / onboarding / signed out | Waits |
| Chat not yet bound to the account | Waits up to 6 s, then opens |
| Wrong account | Dropped |
| Demo or App Review Demo open | Dropped |
| Tap waiting more than 10 min (e.g. you signed in much later) | Dropped |

- **Routes come only from `routeForPush`:** fixed paths plus UUID-checked ids. A payload can never supply a path.
- **Fixed:**
  - The cold-start tap is now consumed (`clearLastNotificationResponseAsync`), so a *later* cold launch can't reopen that old chat.
  - The tap time is the time it was tapped, because `notification.date` is in seconds on iOS and in milliseconds on Android. The independent review caught this.

**Offline and reconnect (Part 16):**
- The existing offline banner is unchanged.
- Sends fail as "Not sent · Tap to retry" (idempotent `client_id`).
- On reconnect, the list and the open chat reconcile, and Seen and Delivered catch up.

## 5 · Performance (Part 22)

- **No read writes per render.**
  - Seen is debounced per chat, and the server no-ops repeats.
  - Delivered is sent only when something newer from someone else arrived.
  - Measured on the web build: opening and leaving a chat 4× with nothing new gave **0** Delivered writes.
- **Cursor events from other people no longer reload the chat list.** Measured: the other person reading 4× gave **0** extra list loads.
- **No duplicate subscriptions:** each one has a unique topic, and they are all torn down on sign-out.

## 6 · Migration 0011 (Part 27)

`supabase/migrations/0011_phase8_device_messaging.sql`:
- `conversation_members.last_delivered_at` (nullable). Backfilled from `last_read_at`, since what was read was delivered.
- `mark_read_upto(p_cid, p_message_id default null) → timestamptz`.
- `mark_delivered(p_cid default null) → integer`.
- `chat_receipts(p_cid) → (user_id, status, joined_at, read_at, delivered_at)`. It is already filtered for privacy, and delivered includes "seen ⇒ delivered".
- The "members read" policy is replaced with a stricter version (Vibe partner rows; 1:1 pending-request and blocked rows).
- All functions are `security definer` with `set search_path = public`, revoked from `public`/`anon` and granted to `authenticated`.
- Unchanged: `mark_conversation_read`, `my_conversations` and everything else Build 5 uses.

## 7 · Independent security review (Part 26)

A separate agent reviewed the diff read-only and probed a scratch database.
- **No critical or high findings.**

| Finding | Severity | Status |
|---|---|---|
| A request recipient's sync / read showed up through the raw table and Realtime (an "online" signal to a stranger) | Medium | **Fixed.** Delivery acks are active-only; the pending recipient's 1:1 row is hidden from the requester. Tests Q1b–Q2b |
| Block: a blocked 1:1 still moved and exposed the cursor; a group across a block exposed delivery times | Medium | **Fixed.** Blocked 1:1 rows are hidden, and there are no delivery acks where any block exists. Tests B3b, B3c, B6, B7 |
| iOS `notification.date` is in seconds, so every iOS tap would have been dropped as "stale" | Medium | **Fixed.** The tap time is used instead |
| A member who declined could still read the sender's receipts | Low | **Fixed.** The caller must be active or request. Test D1 |
| Group raw `last_read_at` across a block | Info | Residual, pre-existing; see §3 |

Otherwise clean:
- Nobody can move another person's cursor; there is no update policy, and cursors only come from server message times.
- No membership probing; anon is refused.
- `search_path` is set on every function; 0011 is idempotent; RLS stays on; no `with check (true)`.
- No secrets, JWTs or OTPs in the client or the logs.

## 8 · App Review Demo (Part 28)

- Still deterministic and local: zero Supabase, analytics, push registration and OTP. `review_test.py` was re-run.
- The Demo chat backend implements the same cursor rules in memory.
- Demo people never read anything on their own, so what you send in the Demo stays "Sent". The Demo never fakes "Seen".

## 9 · Posting reliability + recording video in Chimp (high priority)

**What testers saw:**
- Posting was fast on one iPhone but slow on another, and sometimes never finished.
- A photo taken in Chimp was lost when its post failed, because it was never in the iPhone's Photos.

**The rule now:** a photo or video captured in Chimp is never lost because a post failed.

### Root causes found in the audit

| # | Cause | Effect |
|---|---|---|
| 1 | Chimp's camera returns a file in the app's temporary cache. Nothing saved it to Photos. | A failed post plus a closed composer meant the moment was gone. |
| 2 | Library photos were picked at quality 0.9. iOS then decodes every 24–48 MP HEIC to full size and writes a full-size JPEG before Chimp resizes it again. | Seconds per photo, a memory spike, and possibly the app being killed. This is much worse on some phones: more memory pressure, 48 MP shots, or photos stored in iCloud. |
| 3 | No step had a timeout: photo uploads, database inserts, and the video upload. The video used an iOS **background** session, which waits indefinitely when the connection drops. | "It never posts" on flaky Wi-Fi or cellular. |
| 4 | Drift and Story posts weren't idempotent, and a retry re-uploaded every photo. | Duplicate posts after a lost response, and slow retries. |
| 5 | Leaving the composer threw the attempt away. | Nothing was left to recover. |

### What changed

**1. A capture is preserved the moment it's taken, before any network work** (`services/capture.ts`)
- **Kept copy:** a durable copy goes into Chimp's own Documents folder (`post-drafts/{draft}/`). It's copied to a temporary name and then renamed, so a crash never leaves half a file.
- **Photos:** it's also saved to the iPhone's Photos library when you allow it. Chimp asks once for **add-only** access, which lets it add to the library but never read or delete.
- **If you decline:** posting still works, and the photo stays in Chimp until it's posted or you discard it.
- **Library picks** are already in Photos and are never duplicated.
- **Disk full:** if the copy fails (for example, the iPhone's storage is full), the composer says so plainly. It never claims the photo is safe.

**2. A durable post draft** (`services/postDrafts.ts`, saved on the phone and per account)
- **What it holds:**
  - text, poll, World or Story target;
  - the media, as kept files, with type, size and Photos status;
  - upload state: uploaded file ids and paths;
  - attempts and the last error.
- **No secrets:** only ids, storage paths and public URLs.
- **When it's saved:** as soon as something is captured, and again on every Post tap before anything is uploaded.
- **Recovery after a crash, kill or "Keep draft":** the main tabs show **"You have an unfinished post"** with Continue, Retry and Discard.
  - A post that was mid-flight is shown as "Chimp closed before it was posted. Your photo is safe."
  - Only the signed-in account's drafts are shown, never another account's on the same phone.
  - Drafts are capped at 12. A capture that exists only in Chimp is never dropped.

**3. Clear states instead of a spinner** (`components/create/PostStatus.tsx`)
- **While it works:** Preparing…, then Uploading 2 of 4… 45%, then Posting…, with a progress bar and "Keep Chimp open until it's posted."
- **Cancel becomes Stop** while it works. Stop keeps the draft.
- **If it fails:** for example "Couldn't post. Your photo is safe. You seem to be offline." The reason varies:
  - offline;
  - the connection stopped responding;
  - the upload didn't go through;
  - the session expired;
  - or the app's own one-line reason.
- **Then you choose** Try again, Keep draft or Discard.
- **Discard warns you** if the photo or video isn't in your Photos: "Discarding deletes it for good."
- **Success** is shown only after the server confirms the post row.

**4. Idempotent retries**
- **Stable post id:** the draft id is the post's id, for Buzz, Drift and Story.
  - A retry after a lost response finds the existing post (duplicate key, then select) instead of creating a second one.
  - Double or triple taps and repeated Retry presses run once.
- **Stable file paths:** each file goes to `{folder}/{you}/{postId}-{key}.jpg|mp4`.
  - Files already uploaded and recorded are reused, never sent again.
  - A file that arrived but wasn't recorded (the app was killed) is found: the server returns "already exists", and on a retry a quick check runs before re-sending.
- **Media keys are never reused:** removing a photo and adding another can't mix up their files.
- **Orphaned files are cleaned up:**
  - **Discard** removes the draft's server files by path.
  - **Before deleting,** it checks that the post really doesn't exist, so a lost-response post keeps its photos.
  - **Offline** clean-ups wait in a queue and are re-checked later.
  - **After a successful post,** files of photos you removed are deleted.

**5. Network and app lifecycle**
- **Uploads stream from the file,** never loaded into memory, using a **foreground** iOS session.
- **Stall watchdog:** no progress for 30 seconds means the upload is cancelled and reported.
- **Database writes** time out after 20 seconds.
- **Expired token:** refreshed once and the upload re-sent. If refreshing fails because the phone is offline, you're told you're offline, not that you're signed out.
- **One quiet automatic retry** happens for a dropped connection, a stall or a server hiccup. Then you're asked.
- **No background uploading is claimed.** If you leave Chimp, iOS may stop the upload. You're retried automatically once, and anything unfinished is offered when you return.

**6. Media optimisation, a different policy per type**

| Media | Policy |
|---|---|
| Photos (Buzz, Drift, chat) | Long edge 1600 px, JPEG 0.8, one resize on the phone. The picker now hands over the original file without re-encoding it. |
| Story | 1600 px |
| World cover | 1800 px |
| Avatar | 1200 px |
| Video from Photos | iOS export at 960×540 H.264, up to 60 s / 50 MB (unchanged) |
| **Video recorded in Chimp** | **720p H.264 at about 3.5 Mbit/s: roughly 26 MB a minute**, up to 60 s, with a 45 MB safety stop |

- Camera captures are kept at high quality (0.92) for the copy you keep in Photos. The upload copy is resized.

**7. New: record a video without leaving Chimp** (`app/create/record.tsx`)
- **In the Buzz composer,** **Record** opens Chimp's own full-screen recorder. The library option remains, labelled **Video**.
- **What the recorder shows:**
  - a 0:12 / 1:00 timer and a progress bar;
  - "10 seconds left";
  - a flip-camera button;
  - controls placed from the phone's real safe area.
- **It stops by itself at 60 seconds.**
- **No microphone access** means it records without sound and says so.
- **When recording stops,** the clip and its poster frame are kept in Chimp and saved to Photos (if allowed), before anything is uploaded.
- **Closing while recording** discards that clip. You chose to leave.
- **New native modules:** `expo-camera` (camera and microphone), `expo-media-library` (save to Photos) and `expo-file-system` (now listed explicitly). **These need the next EAS build.**

### Permission text (Info.plist, via config plugins)

| Permission | Text |
|---|---|
| Camera | "Chimp uses the camera so you can take photos and record short videos to post." |
| Microphone | "Chimp uses the microphone to record sound for videos you record, and voice notes in After Dark." |
| Photos (read) | "Chimp uses your photos so you can share them in posts, stories and your profile." |
| Photos (add) | "Chimp saves photos and videos you take in Chimp to your library, so they're never lost if a post doesn't go through." |

### Independent review (posting)

A separate agent reviewed the posting code read-only. It found **1 critical, 3 high and 5 medium** issues, plus some low ones. **All were fixed and re-tested.**

- **Critical: media keys were reused after remove-then-add.** A removed photo's kept or uploaded file could stand in for the new photo.
  - **Fix:** keys are unique and never reused, and removal updates the stored draft.
- **High: kept folders could be tidied before saved drafts loaded.**
  - **Fix:** tidying waits for drafts to load, and loading merges instead of replacing.
- **High: Discard while offline could delete files of a post that did land.**
  - **Fix:** files are deleted only when the post is confirmed absent. Otherwise the clean-up is queued and re-checked.
- **High: in the Demo, posted photos broke because their kept files were deleted.**
  - **Fix:** Demo keeps them, and tidying leaves them alone.
- **Medium: a recorded clip didn't replace an earlier one in the stored draft.**
  - **Fix:** the new clip now replaces the old one.
- **Medium: a killed app re-sent a whole file on retry.**
  - **Fix:** a check runs before re-sending.
- **Medium: a half-written kept copy after a crash.**
  - **Fix:** the copy goes to a temporary name and is then renamed.
- **Medium: a failed keep was silent.**
  - **Fix:** there is now a "Not saved anywhere yet" warning.
- **Medium: wrong failure wording.**
  - **Fix:** a Storage refusal is no longer called an expired session, and "Upload failed" is no longer called offline.
- **Medium: some lookups had no timeout.**
  - **Fix:** they now time out after 20 seconds.
- **Low: drafts dropped by the cap left server files behind.**
  - **Fix:** their files are queued for clean-up.
- **Low: a draft the server confirmed could be left behind if the app closed first.**
  - **Fix:** it is tidied on the next launch.
- **Low: a Photos status that arrived during posting could be overwritten.**
  - **Fix:** it is kept.
- **Low: closing the recorder mid-recording went back twice.**
  - **Fix:** it now goes back once.
- **Known web-only limit:** a draft's photo picked in a browser is a temporary `blob:` URL that dies on reload. iPhone drafts use real files.

### Tested (simulated, not an iPhone)

- **Node, `p9`: 41/41.** Covers:
  - kept copies: atomic, survive cache clearing, report a disk-full failure;
  - add-only Photos permission: asks once, never nags after "no", never throws;
  - draft persistence and "interrupted" after restart;
  - double-tap lock, failure copy, and video plus poster preservation;
  - unique keys, waiting for drafts to load, and Demo files staying.
- **Web, `post9`: 31/31** against a mock that mirrors Storage and PostgREST: 409 on duplicate files, 23505 on duplicate rows, injected failures, hangs, delays and lost responses. Covers:
  - text and photo posts;
  - an automatic retry after one dropped upload;
  - a persistent failure showing the clear message and the three choices;
  - post-row failure: the retry reuses the upload;
  - a lost response giving one post, and a triple tap giving one post;
  - Keep draft, then the card, then a restart, then Retry;
  - a kill after the upload: reopened as "Chimp closed before it was posted", with no re-upload on Retry;
  - Discard removing the server file and media row;
  - offline, then back online, then Try again;
  - Stop mid-upload, a Drift lost response, and a Story;
  - the recorder screen opening and closing.
- **Updated old test:** 6C's "interrupted upload" test now expects the automatic retry.
- **Not testable here:** saving to Photos, kept files on iOS, the real camera, a real network and memory, and backgrounding. All of these are in the device checklist.

### Real-iPhone posting checklist

Do this on **your phone (fast), your friend's phone (the slow one), your brother's iPhone 16, and an iPhone 17**, all on the new build.

| # | Test | Pass when |
|---|---|---|
| P1 | Photo from Photos → Post (Wi-Fi, then cellular) | Preparing → Uploading → Posting, then it posts. Note the seconds on each phone. |
| P2 | **Take a photo in Chimp** → Post | The first time, iOS asks to **add** to Photos. The photo appears in Photos **before** posting finishes. |
| P3 | Take a photo, turn on **Airplane Mode**, Post | "Couldn't post. Your photo is safe. You seem to be offline." Keep draft. The photo is in Photos. |
| P4 | Airplane Mode off → the "unfinished post" card → Retry | Posts once (check the feed for duplicates). |
| P5 | Take a photo, Post, then **swipe the app away** during "Uploading…" | Reopen: "You have an unfinished post … Chimp closed before it was posted." Retry posts once. |
| P6 | **Record a video in Chimp** (Record) for about 20 s → Post | The clip is in Photos right away. Upload progress is shown, and it posts and plays. |
| P7 | Record and let it run to 60 s | It stops by itself at 1:00. |
| P8 | Deny Photos (Settings → Chimp → Photos → None), take a photo, Airplane Mode, Post → Keep draft, force-quit, reopen | The card offers it. Discard warns "isn't in your Photos". Keep it, go online, Retry: it posts. |
| P9 | Video from Photos → Post on the slow phone | No endless spinner. Either it posts, or after about 30 s without progress there's a clear error with Try again. |
| P10 | Text-only Buzz, a Board (World) post, a Story | Each posts once. |
| P11 | Press Home during "Uploading…", wait 1 minute, come back | Either it finished, retried by itself, or shows the error and keeps the draft. Never a silent loss. |
| P12 | Double-tap Post | One post. |

If P1 is still slow on your friend's phone, note the photo's resolution (Settings → Camera → Formats) and whether the photo shows a cloud icon in Photos. iCloud photos have to download first, and that delay is iOS's, before Chimp has the photo.

## 10 · Content ordering + profile Recent Posts (pre-TestFlight)

No schema, migration, RLS, messaging, posting-pipeline or Opportunity Graph changes. Every surface sorts the rows the app already loads (the newest 300 Buzz and 300 Drift the account may see, fetched `order by created_at desc`), so no new query or index is needed.

### Ordering rules (`src/utils/feedOrder.ts`, pure and unit-tested)

| Surface | Order | Where |
|---|---|---|
| Buzz → **For You** | Newest first (`created_at` desc). No engagement or graph ranking; your new post is simply the newest. | `graph/surfaces.ts → buzzFeed('forYou')` |
| Buzz → **Following** | Newest first, from people and Worlds you follow (unchanged rule). | `rankBuzz('following')` |
| Buzz → **Trending** | Engagement score (below). | `rankBuzz('trending')` |
| **Drift** (Buzz tab and the full-screen viewer) | Newest first, World photos/videos and photo/video Buzz together. | `buildDriftFeed`, `driftQueue` |
| Board → **Today** | Cover: the newest photo/video created today. If today's posts can't be a cover (text-only, for instance), there's no cover, so nothing older sits above them. With nothing new today, the cover is the graph's choice as before. Then **New today** (today's posts, newest first) and **Earlier** (older posts, newest first) underneath. Then the edition's modules, in the same graph order as before. | `buildEdition → latest`, `Edition.tsx → LatestPosts` |
| Board → **Buzzing** (Today module) | Engagement score; top 3. Nothing pinned. | `buildEdition` |
| Board → **Explore** | The World's posts (Board posts, Buzz, World photos/videos) newest first, so you scroll down into older posts. Tips, Stories and Moves keep their graph order and are slotted in after every 5 posts without changing the posts' order. Related Worlds follow, each with its own "More from …" marker, also newest first. | `buildExplore` |
| Profile → **Recent posts** | Newest first. | `recentPostsFor` |

"Today" means since local midnight on the phone. All comparators end with "newest, then id", so the order is total and repeatable.

**Pagination.** Every list is sorted in full first, then shown page by page: the Buzz FlatList rows, Explore's 12 at a time, Today's "Show more", the profile grid's 12 at a time, and Drift's first 60. A later page never reorders an earlier one; the tests check pages joined back equal the full order. Trending and Buzzing rank within the loaded window (newest 300), so a viral post older than that isn't a candidate, which suits the recency intent.

### Trending / Buzzing formula

```
engagement    = likes × 1 + comments × 1.5
aged          = engagement × 0.5^(ageDays / 7)        // 0.9 after a day, ½ after a week, ¼ after two
recency boost = 6 × 0.5^(ageHours / 24)               // 6 → 3 after a day → ~0 after a week
score         = aged + recency boost                   // ties: newest, then id
```

- **Likes** are the real totals, including yours. **Comments** are the post's replies (Buzz `replyCount`).
- **Why the aging term:** a purely additive boost can't stop an old viral post staying on top forever, because its lead never shrinks. Gentle aging fixes that, while engagement still decides for posts a day or two apart.
- **No reshuffling while you read:** the Buzz tab fixes the ranking time while you read. It moves on when you switch tabs or pull to refresh. New likes, new comments and new posts still update the order at once.
- **Examples (tested):**
  - 30 likes 2 days ago beats 10 likes now.
  - 10 likes now beats 40 likes 3 weeks ago.
  - 200 likes 90 days ago is below 15 likes today.
  - 500 likes 30 days ago is below 50 likes today.
  - 14 likes + 6 comments beats 14 likes.
- **Tuning:** the constants are in `ENGAGEMENT` (`utils/feedOrder.ts`).

### Profile → Recent posts (`components/profile/RecentPosts.tsx`)

- **Where:** on other people's profiles (after Boards, before Moves) and on **You** (after your Boards).
- **What it shows:**
  - The person's **Buzz** and **World photo/video posts** (Drift), combined.
  - A 3-column grid of square tiles: photo, video poster (▶ badge) or several photos (⧉ badge).
  - Text-only Buzz and polls appear as a small text card.
  - Tapping a tile opens the post: `/buzz/<id>` or `/drift/<id>`.
- **Live updates:** it's built from the same items the feeds show (no copies). A new post appears first at once; an edit or deletion shows at once.
- **What the viewer may see:**
  - Nothing from someone you blocked: "You blocked X, so their posts are hidden".
  - Never After Dark.
  - Never a World you can't see. `canViewBoard` mirrors the server's `can_see_board`: public, owner, member, or Connections-and-connected. RLS still decides what a real account ever receives; this keeps cached and Demo data to the same rule.
- **Empty state:**
  - On You: "No posts yet" and "Create a post".
  - On someone else's profile: "No recent posts".
- **Known limit:** the grid is built from what the app has loaded (the newest 300 Buzz and 300 World posts across Chimp). It only says "recent" for that reason. A person whose last post is older than that window shows "No recent posts".
  - **Follow-up if that becomes visible as usage grows:** a per-author query (`buzz_items` / `drift_items` by `author_id`, still under RLS). With it, indexes on `(author_id, created_at desc)`, and on `created_at desc` for the main feed (none exist today).
  - That's a DB change, so it's described here, not implemented.
- **Blocks:** posts from someone **who blocked you** aren't hidden. The server's content read rules don't consider blocks, and the app only knows whom *you* blocked. The feeds already behave this way; this update doesn't change it.
- **Not included:** Demo-only Board posts (fixtures) have no full-post screen, so they're left out.

### Tests

- **Node `o10.ts`:** 80 checks covering the rules, every surface on a REAL fixture, privacy, live updates, pagination and Demo isolation.
- **Web `o10_web.py`:** 25 checks covering the REAL account against the mock: tab order, Today / Buzzing / Explore, the grid geometry, tile taps, private / blocked / empty, and your new post appearing at once.
- **`c6.ts`:** one Trending expectation was updated to the new rule. 12 likes 6 h ago now passes 20 likes 3 days ago.

### iPhone checks (not run on a device)

| # | Do | Expect |
|---|---|---|
| O1 | Post a text Buzz | It's first in For You and first in your Recent posts. |
| O2 | Following / Drift | Newest first. |
| O3 | Like and comment on an older post, then switch tabs or pull to refresh | It rises in Trending. A fresh post with a few likes can pass a much older one. |
| O4 | Open a World with posts from today and earlier | Cover and **New today** first, newest first, then **Earlier**. Buzzing shows the most-liked/commented. |
| O5 | Explore, scroll to "Keep exploring" twice | The order continues into older posts and never jumps. |
| O6 | Open a friend's profile | 3-column grid, newest first, photos/videos as thumbnails, text as cards. Tap opens the post. |
| O7 | Open the profile of someone with a post in a private World you're not in | That post isn't in the grid. |
| O8 | A new account's You | Clean "No posts yet". |

---

## Files

**New:**
- `supabase/migrations/0011_phase8_device_messaging.sql`
- `src/components/system/SafeArea.tsx` (`DeviceInsetsProvider`, `useDeviceInsets`, `FullscreenTopBar`)
- `src/theme/safeArea.ts`
- `src/utils/receipts.ts`
- `src/components/chat/SeenBySheet.tsx`
- `src/services/backend/realtimeTopic.ts`
- Posting reliability:
  - `src/services/capture.ts`
  - `src/services/postDrafts.ts`
  - `src/utils/postDraft.ts`
  - `src/components/create/useDraftComposer.ts`, `PostStatus.tsx`, `UnfinishedPostCard.tsx`
  - `src/app/create/record.tsx` (in-app video recorder)

**Changed:**
- `_layout.tsx` (device-insets provider, `pushGate`)
- `board/[id].tsx`, `BoardTabs.tsx`
- `MediaViewer.tsx`, `StoryViewer.tsx`, `drift/[id].tsx`, `VibeChat.tsx`
- Modal sheets: `MessageMenu`, `LoopsSheet`, `PingSheet`, `OwnerMenu`, `WorldOwnerMenu`, `VibeParts`
- `theme/layout.ts`, `hooks/useLayout.ts`
- `services/backend/chat.ts`, `chatApi.ts`, `demoChat.ts`, `push.ts`, `pushRoutes.ts`
- Realtime topics in `backend/afterDark.ts` and `backend/people.ts`
- Posting reliability:
  - `services/create.ts`, `backend/media.ts`, `backend/content.ts`
  - `app/create/buzz.tsx`, `drift.tsx`, `story.tsx`, `CreateParts.tsx`
  - `app.json` (plugins and permission texts), `package.json` / `package-lock.json`
- `store/useChat.ts`, `ChatBubble.tsx`, `ConversationBody.tsx`, `RealChat.tsx`
- Content ordering + Recent posts (section 10):
  - **New:** `src/utils/feedOrder.ts`, `src/components/profile/RecentPosts.tsx`
  - **Changed:**
    - `graph/surfaces.ts` (`buzzFeed`, `visibleBuzz`, Trending, `buildDriftFeed`, `driftQueue`, `canViewBoard`, `recentPostsFor`)
    - `graph/worlds.ts` (Today `latest` and cover, Buzzing, Explore)
    - `components/boards/Edition.tsx`
    - `app/(tabs)/buzz.tsx`, `app/drift/[id].tsx`, `app/profile/[id].tsx`, `app/(tabs)/you.tsx`
    - `utils/buzzRows.ts` (comment only)

## Tested locally (simulated; not an iPhone)

| Suite | Result |
|---|---|
| TypeScript (`tsc --noEmit`) / `expo lint` | Clean / clean |
| **DB: `pg_8_test` (0011: cursors, receipts, Vibe policy D, requests, blocks, groups, Build 5 compatibility)** | **53/53** |
| DB: the 10 earlier suites (0002–0010) | **Identical with and without 0011** (chat 35, msg 113, 6D 62, 7B 122, 7C 96, Build 5 18, …). The few legacy failures in old 6C/7A files are the same before and after; they test flows that later migrations replaced, e.g. 7A view-once before 7B's private path |
| DB: 0011 applied twice (idempotent) | ✓ |
| Node: `p8` (receipts, server-µs time, safe-area rules, Board pin rule, nested routes, `pushGate`, chat store Seen/Delivered/receipts/cursor events/sign-out) | **52/52** |
| Node: m7 38 · a7 90 · t7 14 · p7 19 · b7 55 · c7client 24 · i7 45 · push7 30 · c6 56 · scenario6 | All pass |
| **Node: `p9` posting (capture preservation, Photos permission, drafts, runner, review fixes)** | **41/41** |
| **Web: `post9_test` posting (retries, idempotency, drafts, restart / kill recovery, discard clean-up, offline, Stop, Drift, Story, recorder screen)** | **31/31** |
| Web: **`msg8_test`**: Sent → Delivered → Seen across browsers, background vs foreground, one status line, group "Seen by N" plus sheet, no write-per-render, no 0011 → "Sent" only | **20/20** |
| Web: **`r8_layout`**: 8 iPhone families with simulated safe areas | **248/248** |
| Web: l7_layout 88 · c7_web 18 · ad7 (390) 56 · ad7 (375) 56 · App Review 31 · ph_web 36 · ad7_sweep 12 · ad7_real 6 · b7_web 23 · tt7_web 10 · chat 38 · m7 80 · b5p2 13 · b5_nav 31 · d6 72 · av 15 · dw 29 · 6C regression 33 | All pass |
| Web: c6_6d (V5–V8 updated: interrupted video uploads now retry automatically) | 68/69. "A4 Buzz ready before the network load" is the known timing flake (it failed the same way in 7C) |
| Long-session cycle / Demo sweep | Completed, 0 page errors / 0 errors |

Test updates made because of intended changes:
- `b7` now finds the events channel by prefix (Realtime topics now carry a unique suffix).
- `b5_nav`:
  - The label-size check now follows Build 5's own rule (15 pt below 390 pt wide).
  - The keyboard check now tests what a browser can: the bar steps aside and no spacer is left. Lifting the composer is iOS `KeyboardAvoidingView`, which is native only, so it's in checklist #14.
- The legacy 6B chat mock now answers like a project **without** 0011 (PostgREST "function not found"), so the old suites exercise the fallback.

**Device matrix (simulated safe areas, Part 24).**

| Family (approx.) | Points | Top / bottom inset |
|---|---|---|
| iPhone 12/13 mini | 375×812 | 50 / 34 |
| iPhone 12/13/14 | 390×844 | 47 / 34 |
| iPhone 15/16 (Dynamic Island) | 393×852 | 59 / 34 |
| iPhone 16 Pro / 17 / 17 Pro | 402×874 | 62 / 34 |
| iPhone 12/13 Pro Max, 14 Plus | 428×926 | 47 / 34 |
| iPhone 15/16 Plus & Pro Max | 430×932 | 59 / 34 |
| iPhone 16/17 Pro Max | 440×956 | 62 / 34 |
| iPhone SE | 375×667 | 20 / 0 |

On each family, the tests checked:
- headers and Back below the status bar;
- Board tabs pinned, at 3 scroll depths, never under the status bar;
- the photo viewer close X at ≥ inset + 8 and 44 × 44;
- the bottom bar clear of the home indicator;
- the chat composer above the bar;
- sign-in and After Dark;
- no horizontal overflow.

**Regression fixture (Part 5).** `r8_layout.py` is the Board-under-status-bar fixture.
- It **fails on the pre-Phase-8 build:** tabs at y = −14 on a 62-pt Dynamic Island phone, and the close X at 66 < 70.
- It **passes on Phase 8.**
- **Limit:** the iOS-only "Modal reports top 0" behaviour can't be reproduced in a browser. That part has to be confirmed on an iPhone.

## Real-device checklist (Part 25), closing Phase 8

The three phones:
- **Your primary iPhone.**
- **Friend's iPhone 17 (base):** 402×874, Dynamic Island, top ≈ 62.
- **Brother's iPhone 16 (base):** 393×852, Dynamic Island, top ≈ 59.

Do all three on the new build, after running 0011. Fourteen priority checks, in order:

| # | Check | Pass when |
|---|---|---|
| 1 | Open any photo full screen (Buzz post, chat photo) | The X sits clearly **below** the Dynamic Island / status bar, never touching it; one tap closes it |
| 2 | Play a video full screen | Video fits; the X and caption stay on screen; the home indicator isn't covered |
| 3 | Story viewer and Drift (Happening) | The progress bar and X are below the Dynamic Island |
| 4 | After Dark: send and open a view-once photo | The X and the "View once…" line are below the Dynamic Island; the photo can be opened once |
| 5 | Board → scroll down | Today / Explore / People pin **below** the status bar with a solid background; the status bar text stays readable |
| 6 | App Review Demo: repeat 1 and 5 | Same, with the yellow banner present |
| 7 | 1:1: A sends while B's app is closed → A sees "Sent" | Only "Sent" |
| 8 | B opens the app (not the chat) | A sees "Delivered" within a few seconds without refreshing |
| 9 | B opens the chat | A sees "Seen" live. Then B locks the phone with the chat still open and A sends again: A sees "Sent" or "Delivered" (iOS may pause B's app) — never "Seen" — until B unlocks and looks |
| 10 | Group of 3: one person reads | "Seen by 1", tap shows that one name; when the third reads, "Seen by everyone" |
| 11 | After Dark Vibe | No Sent/Delivered/Seen anywhere, for either person |
| 12 | Push tap with the app killed (message from the other phone) | Opens that chat once signed in; a later normal launch doesn't reopen it |
| 13 | Unread: badge counts go to 0 when you read; sign out and sign in as another account | No old unread counts or chats carry over |
| 14 | Keyboard in a chat (all three phones) | The bottom bar hides, the composer sits on the keyboard, nothing overlaps; after dismissing, the bar returns |

If 1–6 pass on the iPhone 16 and 17, the reported bugs are closed. If anything fails, send a screenshot and the phone model.

## Final status: TestFlight readiness

| Item | Status |
|---|---|
| TypeScript / lint | Clean |
| DB tests incl. 0011 (local Postgres) | Pass (53/53 new; earlier suites unchanged) |
| Node / web regression (simulated) | Pass, except one known timing flake (c6 A4) |
| Migration 0011 on your Supabase | **To do** (step 1) |
| `npm install` (new packages) | **To do** |
| EAS build | **Required** (2 new native modules). Not started (your call) |
| Real-iPhone posting checks (P1–P12, four phones) | **To do** |
| Real-iPhone checks (iPhone 16, 17, yours) | **To do.** These close Phase 8 |
| Opportunity Graph v2 | Not touched (out of scope) |
| Commits / push / merge | None made |


# Chimp build notes — v0.7C — Product Polish, Early Opportunity Intelligence, Push & Build Readiness

2 Oct 2026 · branch `phase-7`.

`master` and the tagged TestFlight Build 4 (`testflight-0.1.0-build4`) are untouched. No commits were made, and no EAS build was started. Migrations 0001–0008 were not modified. The one new migration is `0009_phase7c_product_intelligence.sql`.

> **Status: implemented and tested locally. Not yet run on an iPhone or against your Supabase project.**
> - **Where it was tested:** a local Postgres with a Supabase stub, Node tests against the real app modules, and a web build in Chromium at the four iPhone sizes.
> - **Push needs a new EAS build.** It also needs an APNs key on your Expo account and the `push` Edge Function deployed.
> - **What closes 7C:** the real-phone checklist at the end.

## What you must do once

1. **Supabase → SQL Editor:** run `supabase/migrations/0009_phase7c_product_intelligence.sql`.
   - It checks that 0008 is there.
   - It's all-or-nothing and safe to run twice.
2. **Edge Function `push`:** Dashboard → Edge Functions → Deploy a new function → Via Editor → name it `push` → paste `supabase/functions/push/index.ts` → Deploy.
3. **Edge Functions → Secrets:**
   - `PUSH_SECRET`: any long random string. Without it, the function refuses everything.
   - `EXPO_ACCESS_TOKEN`: strongly recommended. In expo.dev → Account settings → Access tokens, create one. Then in your project's push settings, turn on **Enhanced push security**. After that, only this function can send to Chimp's users. Anyone who somehow learned a device's push token cannot.
4. **Database → Webhooks → Create** (instant delivery):
   - Table `public.push_outbox`, event **Insert**, type "Supabase Edge Functions" → `push`, method POST.
   - Header `x-push-secret: <PUSH_SECRET>`.
5. **Integrations → Cron** (retries, receipts, clean-up):
   - Every minute: POST `{"action":"send"}` to `push`.
   - Every 15 minutes: POST `{"action":"receipts"}`.
   - Both with the same header.
6. **APNs key for Expo (once):** `npx eas-cli@latest credentials` → iOS → production → **Push Notifications: set up a key**. You can also accept the prompt during the next `eas build`.
7. **New EAS build.** I did not start one. It's needed because 7C adds three native modules: `expo-notifications`, `expo-device`, `@react-native-community/netinfo`.

Without step 1, the app still works:
- Follow / Crush fall back to the old table writes.
- Analytics switches itself off for the session.
- Notification settings say "aren't available yet".

---

## 1 · Design system and layout (Parts 1–6)

**One skeleton, two moods.** A single set of layout tokens (`src/theme/layout.ts`) now drives every primary tab. Normal Chimp and After Dark use the same header, the same segmented control and the same bottom bar. Only colour and mood differ (light / blue vs dark / pink). No second design system.

| Token | Value | Token | Value |
|---|---|---|---|
| gutter | 16 | segmented height | 38 (padding 3, radius 22) |
| header top | 6 | header → subtitle | 4 |
| header → segmented | 12 | section gap | 20 |
| card padding / radius | 14 / 20 | compact gap | 10 |
| empty-state padding | 16 | bottom nav | height 64, radius 28, side margin 14 |
| nav bottom inset | max(safe-area − 8, 10) | scroll space | nav + inset + 14 |

- **`PageHeader`:**
  - Rebuilt on the tokens.
  - A `subtitle` slot replaces the free-floating subtitle lines in Buzz and Happening.
  - A `compact` mode for After Dark: no eyebrow, title1 size, the same gutter and rhythm.
- **`Segmented`:**
  - One component with three tones: light (Buzz), dark (over media), night (After Dark).
  - Same 38-pt height everywhere; per-segment "new" dots.
  - A tight mode so the five After Dark labels fit at 375 pt. "Challenges" used to clip.
- **After Dark (Part 2):**
  - Header: the same compact `PageHeader` with the 18+ mark.
  - Tabs: the shared `Segmented` (night tone).
  - Section labels: sentence case instead of all-caps.
  - Empty states: compact, left-aligned.
  - **Vibes empty:** "No Vibes yet / Mutual interest becomes a Vibe when both people say yes. / [Discover people]".
  - **Plans:** the "Plans are private to the two of you. Nobody else sees them." paragraph is gone. Empty state: "No plans yet / Turn an Open Loop into a private plan you both agree on." The plan sheet still says "Only you and {name} see it."
  - The five tabs (Discover / Vibes / Challenges / Plans / Inbox) are kept.
- **Buzz card overflow (Part 3), fixed at the root:**
  - **The cause:** the World chip (and long usernames) had no `minWidth: 0` / `flexShrink`, so a long name pushed the row past the card. It overflowed by up to 132 px at 375 pt.
  - **The fix:**
    - The chip row wraps.
    - Chips, titles and usernames can shrink and truncate.
    - "Creator" moves to the next line instead of off the card.
    - Timestamps never shrink.
  - Applies to all four card variants.
- **Bottom nav / safe area (Part 4):** one inset rule, and a gradient backdrop behind the floating bar so content never shows around or under it. Every tab's scroll space comes from the same function.
- **Developer gear (Part 5):**
  - The blue gear is Expo's dev-menu "Tools" button, not Chimp's ([expo#44234](https://github.com/expo/expo/issues/44234)).
  - The app can't hide it, and it doesn't exist in TestFlight builds.
  - Chimp's own developer tools stay in Settings → Graph Debug (developer accounts only).
- **Responsive (Part 6):** tested at 375×667, 390×844, 393×852 and 430×932 (`l7_layout`, 88/88).
  - No horizontal page overflow.
  - Nothing inside a Buzz card renders outside it.
  - The last item of Buzz, Boards, Happening and You ends above the bar.
  - Header gutter, segmented height and bar size are identical in Buzz and After Dark.
  - Long-name fixtures are part of the test: "jordanblackwoodmontgomery_official" and the World "Boston Founders & Builders Collective — Weekly Gathering".
  - No Android work was done, and nothing here is iOS-only: tokens and the safe-area rule are platform-neutral.

## 2 · Simplification audit (Part 7)

| What | Why | Consequence for people | Done? |
|---|---|---|---|
| Plans intro paragraph | Repeated on every visit; the plan sheet already says it | One less paragraph; Plans opens straight on the list | **Yes** |
| All-caps section labels in After Dark | Shouting, and inconsistent with the rest of Chimp | Calmer, easier to read | **Yes** |
| Subtitles floating below headers (Buzz, Happening) | Ad-hoc spacing, different per screen | Same rhythm on every tab | **Yes** |
| "Spark" for a mutual Crush (Happening, profile, You) | Two words for one thing | "Mutual Crush" everywhere. The Vibe *stage* "Spark" is unchanged. | **Yes** |
| Happening "WHY THIS MATTERS TO YOU" | Read like a feed of reasons | Now "CHANGED IN YOUR WORLD": the few deltas that matter now | **Yes** |
| **% match on people (MatchCard, profile ring)** | The 7C brief says no invented compatibility percentages. The number is a ranking score, not a measured compatibility. | Recommend replacing it with plain reasons ("You're both in Japan Trip") or a word ("Strong match") | **No — your call** (flagged in the analysis) |
| `TRENDING.halfLifeHours` (unused) | Trending sorts by likes, then newest; the half-life is dead config | None today. Either use it or delete it. | No (kept; tests rely on Trending's simple rule) |
| Graph Debug shows the private-Crush signal | Developer-only screen behind the server allow-list | None for users | No |
| Follow World vs Join World | Different meanings (follow = more of it; join = belong) | Keep both | No |

## 3 · Terminology (Part 8)

| Term | Means | Where it shows |
|---|---|---|
| Follow | "I want more of your world" | Profile menu, Worlds |
| Connect | A mutual social relationship | Profile, requests on You |
| Crush | Private romantic interest. Nobody is told. | Profile, Discover |
| Mutual Crush | Both chose each other | Happening, profile, You (was "Spark") |
| Vibe | An active mutual romantic space (After Dark) | After Dark |
| Open Loop | Something unresolved you want to happen | You, chats, Discover prompt |
| Plan | An Open Loop made concrete (when / where) | After Dark → Plans |

## 4 · Opportunity intelligence (Parts 9–15)

**Not** Opportunity Graph v2: no GNN / TGAT / TGN / GraphSAGE / LightGCN, no training pipeline, no reinforcement learning, no monetization.

### Decomposed signals

Every ranked thing is scored from the same signals (`src/graph/signals.ts`), each 0..1:

```
opportunity = 100 × Σ weight × signal − repetition × 10 − saturation × 20 (− the existing dislike penalty)
```

| Signal | Means | People | Buzz For You | Happening | Discover |
|---|---|---|---|---|---|
| relevance | fits who you are | 0.50 (the match) | 0.34 | 0.30 | 0.40 |
| relationship | ties you already have | 0.12 | 0.24 | 0.15 | 0.20 |
| timing | relevant now | 0.12 | 0.18 | 0.25 | 0.10 |
| intent | what you said you want | 0.10 | 0.08 | 0.15 | 0.15 |
| actionability | something concrete to do | 0.08 | 0.06 | 0.08 | 0.05 |
| novelty | new to you | 0.05 | 0.06 | 0.05 | 0.08 |
| confidence | how much evidence | 0.03 | 0.04 | 0.02 | 0.02 |

- **Safety** is a gate, not a weight: unsafe means never ranked. Blocked people and After Dark content in normal surfaces are already filtered out.
- **Where the settings live:** weights, half-lives and penalties are in `src/graph/config.ts` (`SIGNALS`, `DECAY`, `MOMENTUM`, `EXPOSURE`). They're explicit and editable.
- **Graph Debug** shows each item's breakdown, for example "62.5 = relevance 0.53 · timing 0.50 · …", and the last Happening selections.
- **Nothing numeric is ever shown to people.** No score, no percentage, no raw parts.

### Time (Part 11)

- **Static interest stays as it was.** Affinity never decays.
- **Timing is a separate signal** (`src/graph/time.ts`). Each kind of action has its own half-life:
  - open 24 h · like 3 days · save 14 days · join 30 days · connect 60 days · Open Loop 30 days.
- **Momentum** is the decayed sum of *recent* affinity gains per interest ("Japan is becoming relevant now").
  - It is capped at a 4-day half-life, so it measures this week, not this month.
  - The same Japan saves two months ago give ≈0 momentum.
- **A Buzz post's own timing** halves every 24 h. This replaces the old linear 36-hour ramp.

### Repetition and saturation (Part 12)

- **What's counted:** exposure is counted per **sitting** (impressions closer than 30 minutes are one sitting). It's stored locally per account (`src/store/useExposure.ts`), never uploaded, and reset on sign-out.
- **Snapshots:** rankings read a snapshot taken when a sitting starts (launch, account change, back to the app). The current sitting never counts, so a list never reshuffles while you scroll.
- **Repetition:** you saw it in an earlier sitting and didn't act. It fades with a 24-hour half-life.
- **Saturation:** it starts at 3 sittings without acting and is full at 7.
- **Strong intent cancels 75% of saturation.** You saved it, joined its World, or opened a loop on it, so relevance can recover.
- **Acting clears both.** If you acted on something after you last saw it, it was useful, not noise.

### Surfaces

- **People suggestions** (You, People, Pulse, Happening):
  - **How they're scored:** the match score is the relevance; timing, intent, actionability, novelty and exposure decide between similar matches.
  - **How much the order moved:** in tests, the top 3 always come from the 8 best matches, and the best match stays in the top 3.
  - **Private Crush:**
    - It still adds a silent 1-point nudge.
    - It is never a reason, a label, a field or an event.
    - Tested: nothing anywhere mentions it.
- **Buzz For You:**
  - **Reordered by the signals:** relevance and relationship come from the existing graph parts; timing comes from age and momentum; dislikes stay a penalty.
  - **Unchanged:** Following (newest first), Trending (likes, then newest) and Buzz → Drift (its own interleave).
- **Happening → "Changed in your world"** (Part 14):
  - **What's ranked:** the same high-context items as before (loops that moved, plans this week, people who now overlap a loop, mutual Crushes, World Delta changes), ranked by the Happening weights.
  - **What's recorded:** each selected item stores why it was chosen (its signals and its pre-7C score), and the last 40 selections are logged locally for Graph Debug.
  - Happening still never shows Buzz or Drift posts, so it isn't a feed.
- **After Dark Discover:**
  - **How it's ranked:** by shared Worlds, shared interests, mutual connections, intent fit (both visible on the cards), timing and "not already seen", ranked once per load so cards don't jump.
  - **What is never used:** your private Crushes and passes.
- **"Why you may vibe"** (Part 13): at most three plain reasons, strongest first, built only from what both people already see on each other's cards.
  - Shared Worlds, shared interests, mutual connections, or the same intent ("You're both up for something casual").
  - Never a number, a Crush, or an inference.
  - If nothing is shared, no reasons are shown (no filler).

### Reversible (Part 15)

`INTELLIGENCE` in `config.ts` has one switch per surface: `people`, `buzzForYou`, `happening`, `discover`. Turning one off restores the pre-7C order exactly. This is tested for people and Happening.

### Fixtures (Part 31)

All in `i7.ts`, 45/45:
- **A** = Travel / Japan / Japan Trip World / recent planning; **X** = a Japan Trip post from 3 h ago; **Y** = a 10-day-old Vintage post.
- Score(A, X) = 63.7 > Score(A, Y) = 13.8. X also wins on relevance, timing and intent separately.
- **Ageing:** timing goes 0.98 > 0.78 > 0.63 > 0.34 > 0.25 at 1 / 12 / 24 / 72 / 240 h, and the total falls with it.
- **Repeated exposure:** saturation goes 0 · 0 · 0.2 · 0.4 · 0.6 · 0.8 · 1 · 1 over 1–9 sittings. The same X drops from 63.7 to 46.1 after many sittings.
- **Strong intent:** a saturated item with strong intent scores 62.6 against 54.6 without it.

### Performance (Part 30)

Measured in Node on the Demo data, including a full graph rebuild:

| | People ranking | Buzz For You | Happening |
|---|---|---|---|
| With 7C signals | 1.8 ms | 3.3 ms | 4.1 ms |
| Without | 0.6 ms | 2.3 ms | 3.2 ms |

- Momentum is computed once per graph context.
- The exposure snapshot is a plain object read.
- Impressions are written at most once per minute per item, and once per sitting.

## 5 · Instrumentation (Parts 16–17)

**Migration 0009 → `product_events`**:
- **Columns:** `event_id`, `user_id`, `event_type`, `family`, `target_type`, `target_id`, `source_surface`, `created_at` (**server time**), `client_at` (the phone's, kept apart), `session_id`, `context`.
- **Families:** content, people, worlds, messaging, after_dark, plans, outcome, app.
- **Writing:** only through `log_product_events(jsonb)`:
  - Each event is checked against an allow-list of event types, target types and id formats.
  - At most 50 events per call and 1,200 per person per hour.
  - Invalid items are dropped, not the whole batch.
- **Reading:** the app can't read, edit or delete events. RLS is on with no policies; only the server key can read them.
- **Retention:** `purge_old_product_events()` keeps 180 days. It runs with the receipts cron.

**Never stored:**
- **Content and credentials:** message text, captions, comments, prompts, answers, OTPs, tokens, JWTs, email or phone, media URLs or paths, report text.
- **Private targets:**
  - Who you have a Crush on: `crush_set` / `crush_remove` keep no target.
  - Who you passed on or looked at in After Dark: After Dark person targets are dropped.
  - Which message: a message is counted, never identified.
- **How it's enforced:**
  - Context keeps short scalar values only.
  - Keys like body / text / url / token / email / name are dropped, and so are id-shaped values.
  - Both the phone and the server apply these rules.

**The client** (`src/services/analytics.ts`):
- REAL accounts only. The Demo, the App Review Demo and signed-out states send nothing (tested).
- Sends in batches: every 10 s, at 20 events, or when the app goes to the background. Queued events are flushed on sign-out.
- A new session id for every sign-in, so two accounts are never linked.
- **Events come from three places:**
  - The local action log (`track`): views, likes, saves, joins, follows, connects, loops, blocks.
  - The chat store: `message_sent` with `kind` and `view_once` only.
  - After Dark actions: pass, Vibe request / accept / decline / pause / close (with the reason category only), challenge send / answer, photo-consent change.
  - Plus `app_open`, `app_foreground` and `push_opened`.

## 6 · Follow / Crush intents (Part 18)

- **The server functions:**
  - `set_follow(other, on)` returns whether you follow them afterwards.
  - `set_crush(other, on)` returns `{crush, mutual}`. `mutual` is true only when they chose you too, which `my_sparks()` already reveals; a one-way Crush tells nobody anything.
  - A repeat tap changes nothing.
  - Blocked and "no such person" give the same "Not available." Blocks aren't revealed.
- **Older app versions** (Build 4) still write the tables directly. A new trigger quietly drops a follow or Crush across a block, with no error to probe with.
- **On the phone:** taps become explicit on/off intents, sent one at a time per person, in tap order, so the server ends where the last tap left it. A failure puts the switch back only if no newer tap is waiting. They count as relationship writes, so the 7B reconcile can't flicker them.
- **Unchanged:** Mutual Crush events (0008), Crush privacy and RLS.

## 7 · Push notifications (Parts 19–25)

```
message / user_event  →  trigger (0009)  →  push_outbox  →  Database Webhook + cron  →  Edge Function `push`  →  Expo  →  APNs  →  iPhone
```

- **No phone ever sends a push.** No privileged key is in the app.
  - The database queues notifications from new messages and from `user_events` (0008).
  - The Edge Function only sends rows the database wrote. Even with its secret, nobody can make it send arbitrary text.
- **Event types:** MESSAGE_RECEIVED, AFTER_DARK_MESSAGE, CONNECTION_REQUEST, CONNECTION_ACCEPTED, MUTUAL_CRUSH, VIBE_REQUEST, VIBE_ACCEPTED, CHALLENGE_YOUR_TURN, PLAN_WAITING_FOR_YOU.

**What a notification says (Part 21):**

| Event | Lock screen |
|---|---|
| Message (1:1) | "Alex sent you a message" — never the text |
| Message request | "Alex sent you a message request" |
| Group | "Trip crew" · "Alex sent a message" |
| Burst (within 30 s) | "Alex sent you 3 messages" (one notification) |
| Connection request / accepted | "Alex wants to connect" / "Alex accepted your connection" |
| After Dark message | "New After Dark message" |
| Mutual Crush | "Something new is waiting for you" |
| Vibe request / accepted | "Someone sent you a Vibe request" / "Your Vibe request was accepted" |
| Challenge / Plan | "A challenge is waiting for you" / "A plan is waiting for you" |

- **After Dark is fully generic:** never a name, a Crush, a challenge or plan's content, a view-once, or anything romantic or sexual. Even the hidden payload is neutral: kind `after_dark` and a tab.
- **Names are cleaned:** control characters are stripped and lengths are capped.

**Reliability (Parts 22–24):**
- **One push per message per recipient:** a unique dedupe key, `message:<id>:<recipient>`.
- **No double sends:** claims use `for update skip locked`.
- **Bursts:** message pushes wait 2 s so a burst becomes one notification. The function waits that out in the same run.
- **Retries:** 429 / 5xx / MessageRateExceeded back off (15 s, 30 s, … up to 1 h). After 5 attempts the push is marked failed. A worker that died mid-send is reclaimed after 5 minutes.
- **Dead tokens:** DeviceNotRegistered, from tickets or from receipts 15 minutes later, deletes the token.
- **Rechecked just before sending:** block, preference, still a member of the chat, message unsent (a burst survives if any of it is left), more than 24 h late.
- **Relationship toggles are throttled:** request / cancel / request gives one "wants to connect" per hour. A Mutual Crush notifies once per day per pair.
- **A push problem can never block the action.** Every push step is wrapped: a failure is logged as a warning and the message or relationship change goes through. Tested by breaking a setting on purpose.

**Tokens (Part 22):**
- **Registration:** `register_push_token` stores one row per device, with a random per-install id.
  - A new token for the same install replaces the old one.
  - A phone that signs into another account moves its token to that account.
  - Ten devices maximum per person.
- **Sign-out:** the phone removes its token while the session is still valid.
- **Account deletion:** tokens cascade away.
- **If the phone couldn't unregister** (offline, revoked session): each token remembers the sign-in session that registered it, and the server stops sending once that session no longer exists.
- **Foreground:** a notification for another account isn't shown, and neither is one for the chat you're reading.
- **RLS:** you see only your own tokens, and there's no direct write.

**Taps (Part 24):**
- **Waiting for the app to be ready:** a tap is held until the session is restored, the right account is signed in and chat has started (up to 6 s). Then it opens:
  - the chat, the group, the Vibe, the challenge, After Dark → Inbox / Vibes / Plans, or the person's profile.
- **This includes the tap that launched the app** (`getLastNotificationResponse`).
- **Ignored:** taps meant for a different account, and taps while the Demo is open.
- **Only safe routes:** routes are built from UUID-checked ids on fixed paths, so a payload can't steer the app anywhere else.

**Settings → Notifications (Part 25):**
- **Three switches:** Messages, Connections, After Dark. They're stored on the server, so they apply to all your phones.
- **Shows the iOS permission state:** a "Turn on notifications" button, or "Notifications are off → Open" iOS Settings.
- **Asking for permission:** once, about 2.5 s after the first screen, for signed-in REAL accounts only.
- **Never:** the Demo, the App Review Demo, the web build or simulators register anything.

## 8 · Offline indicator (Part 26)

- **What it looks like:** a small "Offline" pill under the status bar. It's REAL mode only.
- **Never in the way:** it never blocks a tap, and it appears only after 1.5 s offline.
- **When it shows:** it uses NetInfo's `isConnected` only. "Internet reachable" comes from a probe to a fixed URL that some networks block, and the pill must never cry wolf.
- **Sends still work offline:** they queue and retry by themselves (7B).
- **EAS:** NetInfo is a native module. Expo Go bundles it, but Build 4 doesn't, so the new build is required.

## 9 · Native requirements (Part 27)

| Package | Version | Why | Native? |
|---|---|---|---|
| `expo-notifications` | ~57.0.21 | permission, Expo push token, taps, foreground handling | yes (config plugin added to `app.json`) |
| `expo-device` | ~57.0.2 | register real devices only (no simulators) | yes |
| `@react-native-community/netinfo` | 12.0.1 | offline pill | yes |

- **Versions:** all installed with `expo install`, at the SDK 57 versions.
- **`app.json`:** adds the `expo-notifications` plugin (Android accent colour). The iOS entitlement it writes is `aps-environment: development`. Xcode's App Store / TestFlight export switches it to production from the distribution profile. Check this on the first TestFlight build, using the real-phone checklist.
- **No `UIBackgroundModes`:** no silent pushes are used.
- **Build:** `npx eas-cli@latest build --platform ios --profile production` (not started).

## 10 · Business model readiness (Part 28)

- **No monetization.** Product events have families and an `outcome` family, so organic, sponsored and transactional can be told apart later. There is no sponsored content and no paid boosts.
- **No pay-to-win dating:** Discover ranking takes no payment input, and none is planned.

## 11 · App Review Demo (Part 29)

Unchanged and still fully local:
- **No network:** zero Supabase calls (31/31), no analytics, no push registration, no NetInfo pill.
- Deterministic and usable without an OTP.

## 12 · Independent security review

A separate reviewer audited 0009, the Edge Function and the client. **No Critical findings.** All of the following were fixed and re-tested:

| # | Finding | Fix |
|---|---|---|
| H1 | A failing push step could roll back the user's message or relationship change | Every push step is wrapped and logs a warning instead (test R2) |
| M1 | An instant webhook defeated coalescing; claim clean-up could queue on locks | 2 s message delay, the function waits it out; all clean-up uses skip-locked; no extra dedupe rows |
| M2 | A sign-out with a dead session left the phone getting pushes | Session-bound tokens (R6/R7); foreground suppression for other accounts |
| M3 | Toggling requests / Crushes could spam pushes | Throttled dedupe keys (R8) |
| M4 | The device-id replacement wasn't scoped to the owner | Scoped to your own tokens. Enhanced push security is now strongly recommended. |
| L1 | Receipts were marked checked even when the fetch failed | Only fetched rows are marked |
| L2 / L3 / L4 | Stale reclaim ignored the attempt limit; late or ex-member pushes went out; unsending the last message dropped a burst | Fixed (R3–R5) |
| L5 | After Dark kinds were visible in the hidden payload | Neutral `after_dark` |
| L6 | Context could hold id-shaped strings; session id spanned accounts | Rejected (R12); new id per sign-in |
| L7 | Old-app direct writes bypassed blocks; block vs "nobody" errors differed; null `on` | Silent guard trigger (R9); same error (R10); explicit on/off (R11) |
| L8 | Control characters in names reached the lock screen | Stripped |

**Not changed:** `collapse_key` is not sent to Expo. Bursts are coalesced on the server instead.

## Files

**New:**
- **Ranking:** `src/theme/layout.ts`, `src/graph/{signals,time,vibe}.ts`, `src/store/useExposure.ts`, `src/hooks/useImpression.ts`
- **Analytics and push:** `src/services/{analytics,push,pushRoutes}.ts`
- **UI:** `src/components/OfflineBanner.tsx`, `src/components/settings/NotificationSettings.tsx`
- **Server:** `supabase/migrations/0009_phase7c_product_intelligence.sql`, `supabase/functions/push/index.ts`

**Changed:**
- **Layout and UI:**
  - `PageHeader`, `Segmented`, `TabBar`, `useLayout`, `BuzzCard`
  - After Dark `AfterDarkHome`, `VibeParts`, `VibesTab`, `PlansTab`, `InboxTab`, `ChallengesTab`, `DiscoverTab` (ranking + safe reasons + impressions)
  - `buzz.tsx`, `happening.tsx` ("Changed in your world"), `settings.tsx` (Notifications), `MatchCard` (impressions), `graph-debug.tsx` (7C signals)
- **Ranking:** `relevance.ts` (people opportunity), `surfaces.ts` (Buzz For You, Happening selection), `config.ts`
- **App wiring and stores:**
  - `_layout.tsx` (push handling, registration, deep links, sittings, offline pill)
  - `useChimp` (intents, events), `useChat` / `useAfterDark` (events)
  - `useSession` (sign-out: unregister + flush + exposure reset)
- **Backend client:** `content.ts` (`set_follow` / `set_crush` with fallback)
- **Terminology:** `surfaces.ts`, `profile/[id].tsx`, `YouParts.tsx`
- **Config:** `app.json`, `package.json`

## Tested locally

| Suite | Result |
|---|---|
| TypeScript · ESLint | clean · clean (no new suppressions) |
| DB · 0009 suite: analytics, tokens, prefs, push text / dedupe / coalescing / generic After Dark / claims / retries / receipts / dead tokens / session-bound tokens / throttling / intents / block guard / cascade, plus review regressions R1–R12 | **96 / 96** |
| DB · 0008 + consent suite with 0009 applied | 122 / 122 |
| DB · messaging 113/113 · chat 35/35 · 6D 62/62. Older suites (7A, RLS 6D, delete World) give identical results with or without 0009. | pass |
| Node · intelligence fixtures `i7` | **45 / 45** |
| Node · `push` Edge Function (messages per device, tickets, dead tokens, retries, receipts, 2 s delay, auth gate, neutral After Dark payload) | **30 / 30** |
| Node · client privacy (tap routing, no path steering, analytics wire format, Demo sends nothing) | **24 / 24** |
| Node · 7A 90/90 · 6C 56/56 · Two Truths 14/14 · messaging 38/38 · 7B 55/55 · consent 19/19 | pass |
| Web · layout at 4 sizes `l7_layout` | **88 / 88** |
| Web · 7C REAL account `c7_web` (notification settings, set_follow, events carry no text, offline pill, "Changed in your world") | **18 / 18** |
| Web · After Dark `ad7_test` 390 / 375 · sweep · REAL without 0007 | 56/56 · 56/56 · 12/12 · 6/6 |
| Web · App Review Demo (zero Supabase calls) | 31 / 31 |
| Web · consent `ph_web` · 7B `b7_web` · Two Truths `tt7_web` | 36/36 · 23/23 · 10/10 |
| Web · messaging `chat_test_6d` · groups `m7_test` | 38/38 · 80/80 |
| Web · 6C `c6_test_6d` (dev build; A4 reads dev-only startup marks) · 6D `d6_test` · avatars · delete World · 6C regressions | 69/69 · 72/72 · 15/15 · 29/29 · 33/33 |
| Web · account cycle (sign in / out / Demo, repeated) · Demo route sweep (every route) | completed, 0 page errors · 0 errors |

**Not tested anywhere yet:**
- A real push: Expo → APNs → iPhone.
- The iOS permission prompt.
- Cold-start taps.
- Your Supabase project's webhook, cron and `auth.sessions`.
- Two phones.

## Real-phone checklist (closes 7C)

1. **Install:** the new build on two iPhones (A, B), both signed in. Allow notifications when asked.
2. **Message pushes:**
   - B locks the phone; A sends "hi" → B gets "A sent you a message" (no text). One notification, not two.
   - A sends three quick messages → one "sent you 3 messages".
   - Tap it → that chat opens, from the lock screen and from a fully closed app.
3. **Already reading:** B is in that chat → no banner.
4. **After Dark:**
   - In a Vibe, A sends a message → "New After Dark message".
   - Challenge → "A challenge is waiting for you"; plan → "A plan is waiting for you".
   - Each tap opens the right place.
5. **Relationships:**
   - Connection request → "A wants to connect"; request / cancel / request → still one.
   - Mutual Crush → both get "Something new is waiting for you".
6. **Settings:**
   - Turn Messages off on B → no message pushes; After Dark still works.
   - Turn After Dark off → none from After Dark.
7. **Sign-out and deletion:**
   - B signs out → no more pushes to B's phone.
   - Sign B in on A's phone → A's pushes stop on that phone and B's arrive.
   - Delete a test account → its devices stop.
8. **Dead token:** uninstall the app on one phone → the next push removes that token (`push_tokens` row gone after the send or receipt check).
9. **Offline:** Airplane mode → the "Offline" pill appears; back online → it goes.
10. **Layout:** on both phones, Buzz with long names stays inside the cards; After Dark matches Buzz's header and tabs; nothing hides behind the bar.
11. **Analytics:** in SQL, `select event_type, target_type, target_id, context from product_events order by created_at desc limit 50;` → no text, no Crush target, no URLs.

## Final status

| FEATURE | STATUS | LOCAL TEST | REAL SUPABASE | REAL IPHONE | TWO PHONE | NEEDS NEW EAS BUILD | READY FOR TESTFLIGHT |
|---|---|---|---|---|---|---|---|
| Shared layout tokens / one skeleton | Done | Yes (88/88, 4 sizes) | n/a | No | n/a | Yes | Yes, after a visual check |
| After Dark header / tabs / empty states | Done | Yes (ad7 56/56 ×2, l7) | n/a | No | n/a | Yes | Yes, after a visual check |
| Buzz card overflow | Fixed (root cause) | Yes (l7; the old card fails the test) | n/a | No | n/a | Yes | Yes |
| Bottom nav / safe area | Done | Yes (l7) | n/a | No | n/a | Yes | Yes, after a visual check |
| Developer gear | Explained (Expo's; absent in TestFlight) | n/a | n/a | No | n/a | No | Yes |
| Terminology (Mutual Crush etc.) | Done | Yes | n/a | No | n/a | Yes | Yes |
| % match on people | **Not changed — your decision** | n/a | n/a | n/a | n/a | — | — |
| Decomposed signals, time decay, momentum | Done | Yes (i7 45/45) | n/a (local) | No | n/a | Yes | Yes |
| Repetition / saturation (per sitting) | Done | Yes (i7) | n/a (local) | No | n/a | Yes | Yes |
| Why you may vibe (safe, ≤3, no %) | Done | Yes (i7, ad7) | No | No | No | Yes | Yes |
| Happening "Changed in your world" | Done (reversible, stored selection) | Yes (i7, c7_web) | n/a | No | n/a | Yes | Yes |
| Product events (0009) | Done | Yes (DB 96/96, Node, web) | **No** | No | n/a | Yes | After 0009 is run |
| Follow / Crush intents | Done (+ fallback) | Yes (DB, web) | **No** | No | No | Yes | After 0009 is run |
| Push: tokens, prefs, outbox, triggers | Done | Yes (DB) | **No** | No | No | Yes | After 0009 + function + webhook + cron |
| Push: Edge Function (Expo → APNs) | Done | Yes (Node 30/30, fake Expo) | **No** | **No** | **No** | n/a (server) | After deploy + APNs key |
| Push: deep links, foreground, settings | Done | Yes (Node routing 24/24, web settings) | No | **No** | **No** | **Yes** | After the phone checklist |
| Offline indicator (NetInfo) | Done | Yes (web) | n/a | No | n/a | **Yes** | Yes |
| App Review Demo (local, zero network) | Unchanged | Yes (31/31) | n/a | No | n/a | Yes | Yes |
| Security review H1, M1–M4, L1–L8 | All fixed + tests | Yes | No | No | No | Partly (client) | Yes |

**7C is complete in code. It is proven only locally. It closes when the real-phone checklist passes on the new EAS build against your Supabase project.**


# Chimp build notes — v0.7B — Reliability, Realtime, Security & Logic Hardening

2 Oct 2026 · branch `phase-7`.

`master` and the tagged TestFlight Build 4 (`testflight-0.1.0-build4`) are untouched. No commits were made, and no EAS build was started. Everything is in the `phase-7` working tree. Migrations 0001–0007 were not modified.

**Goal:** Chimp should behave reliably across real devices and real accounts. This phase fixes the three reported bugs at their root, then applies the same pattern everywhere shared state lives. There is no UI redesign; that is deferred to 7C.

> **Status: implemented and tested locally. Not yet proven on two phones against your Supabase project.** Everything here ran against a local Postgres (with a Supabase stub) and a multi-user web mock of Supabase. Nothing ran on an iPhone or on your project. The two-phone script at the end is what closes Phase 7B.

## Phase 7B patch — After Dark photo / view-once consent (2 Oct 2026)

**Report:** in a Vibe, the action sheet showed Challenge / Plan / Photo / View-once photo, and Photo and View-once couldn't be sent. Both share one path and one consent rule, so they had the same problem.

### Root cause

| | Finding | Verdict |
|---|---|---|
| A | **Photos are off by default.** `vibe_members.allows_photos` defaults to `false` (0007, by design). Until the *recipient* turns on "What Maya can send you → Photos", neither a photo nor a view-once photo may be sent. | Expected, and the most likely situation on your phones |
| B | **The UI made it look broken.** Photo and View-once looked like normal, active rows. Tapping one closed the sheet and put a small red line above the composer ("… hasn't turned on photos"), which is easy to miss and reads as an error. | UX bug: fixed |
| G | **When photos *were* allowed, the picker opened while the sheet was still sliding away.** iOS can't present the photo picker on top of a modal that is mid-dismissal; the picker silently doesn't appear. | Fixed defensively (can't be confirmed without an iPhone) |
| B | **Stale consent.** The sheet trusted the Vibe as the screen had loaded it, and there was no fresh server check before picking. | Fixed |
| G | **Failure handling:** a refused or failed photo showed only "Not sent". The upload of a refused photo was left behind, and a retry uploaded the file again. "Upload failed: …" was misread as "offline" (`kindOf` matched "load failed" inside "upload failed"). | Fixed |
| G | **The Controls sheet caption described the wrong person's setting** (what *you* may send *them*, worded as what *they* may send *you*). | Fixed |
| C/D/E/F | Upload paths, message types, media-kind validation, RLS and view-once (7B) all behave correctly. The server refuses exactly what consent forbids. | No bug |

Not changed: consent stays recipient-controlled, RLS is untouched, there's no new media path (view-once still uses 7B's private bucket and server function), and no migration.

### How consent is enforced (three layers)

1. **Database (unchanged, authoritative).** 0007's "messages send" policy calls `vibe_can_send(conversation, type, view_once)`. A photo or view-once photo needs the **other member's** `allows_photos`, an **active** Vibe and **no block**.
   - Only you can change your own switch (`set_vibe_controls` updates your row only).
   - Disguising a photo as text or voice is refused by 0007's media-kind guard.
   - Newly tested: PH1–PH10.
2. **Client service layer.** Before opening the picker, the app asks the server the same question (`rpc vibe_can_send`, new `canSendInVibe` / `useAfterDark.canSend`). The Demo uses its own mirror of the rule.
   - "No" → the app re-reads the Vibe and says "Photos aren't enabled for this Vibe yet." (or "This Vibe is no longer active.").
   - Can't tell (offline) → the database still decides when the message is sent.
3. **UI.** When the other person hasn't enabled photos, **Photo** and **View-once photo** stay visible but **Locked**: dimmed, dashed border, a lock pill, and they can't be tapped.
   - One calm line under them: "Leah hasn't enabled photos yet. Leah decides whether photos can be sent to them."
   - Challenge and Plan are unaffected. There's no "request access" feature (none existed); people can simply ask in the chat.

### Live consent updates

`set_vibe_controls` touches the Vibe row, which the After Dark Realtime channel already listens to. The sender's Vibe reloads within about half a second, and the open sheet re-renders: Locked ⇄ active.

Opening the sheet also re-reads the Vibe, and coming back to the app re-reads it (7B's foreground reconcile). So even if Realtime is asleep, the sheet never shows stale consent. The server check before picking is the final guard.

### Sending and failing

- **Order:** pick (cancel = nothing happens, no message) → upload → send. If the message is refused (consent changed mid-upload, the Vibe ended or paused, a block), the uploaded file is **removed** and the bubble says why.
- **Failed bubbles** show a plain reason above "Not sent · Tap to retry":
  - "You're offline. Try again when you're connected."
  - "This Vibe is no longer active."
  - "Photos aren't enabled for this Vibe yet."
  - "Couldn't send the photo. Try again."
- Never an RLS, Postgres or storage message.
- A failed view-once bubble says "Not sent", not "Not opened yet".
- **Retry after a network drop reuses the already-uploaded file** (no second upload). After a refusal, it uploads again only if consent now allows it.
- **View-once:** unchanged 7B design (private bucket, server-only open, once, Opened shown to the sender). The row is Locked with "View-once isn't set up on the server yet." if the `view-once` function isn't deployed.

### Layout (this sheet only; no global After Dark restyle)

- The four tray rows share one height (60 pt), locked or not, with the same padding, gaps and text alignment.
- Helper text wraps (no clipping); labels truncate on one line.
- The sheet keeps its safe-area bottom padding.
- Tested at iPhone 12 (390×844) and 15 Pro Max (430×932): nothing overflows or clips, and the composer stays above the bottom edge.

### The blue developer gear

It isn't Chimp's code. It's the Expo dev-menu **Tools** floating button that Expo Go (and expo-dev-client) draws above every app ([expo#44234](https://github.com/expo/expo/issues/44234)).

- The app can't move or hide it, and Expo currently has no setting to hide it.
- It does **not** exist in TestFlight or App Store builds.
- Chimp's own developer tools remain in Settings → Graph Debug (server allow-list), so nothing was removed.

### Files changed

- `src/components/afterdark/v2/VibeChat.tsx`: locked rows, server check before picking, picker after the sheet is dismissed, plain failure reasons, equal row heights.
- `src/components/afterdark/v2/VibeParts.tsx`: `ChoiceRow` gets a `locked` state and `style`; `DarkSheet` gets `onDismissed`.
- `src/components/afterdark/v2/DisconnectSheets.tsx`: correct Controls caption; plain error text.
- `src/store/useChat.ts`: `failKind` (offline / refused / other); reuse an uploaded file on retry; remove the upload of a refused message.
- `src/store/useAfterDark.ts`, `src/services/backend/afterDark.ts`, `src/services/afterDarkApi.ts`: `canSend` → `vibe_can_send`.
- `src/services/demoAfterDark.ts`: the Demo mirror of `canSend`, plus a test hook for the partner's switch.
- `src/services/backend/errors.ts`: "Upload failed" is no longer read as offline.

### Tests

| Suite | Result |
|---|---|
| TypeScript · ESLint | clean · clean (no suppressions) |
| DB · 0008 suite + consent PH1–PH10 (off: photo, view-once and disguised refused; the sender can't flip the recipient's switch; text unaffected; on: both allowed and delivered; paused: nothing) | **122 / 122** |
| Node · consent `p7.ts` (Demo backend + stores) | **19 / 19** |
| Web · consent `ph_web.py` at 390×844 and 430×932 (locked rows and note; no picker on locked; unlocked: picker opens after the sheet closes; photo sent; view-once sent; cancel sends nothing; no overflow or clip; equal heights; composer visible; zero Supabase calls) | **36 / 36** |
| Web · After Dark `ad7_test` (390 / 375 wide) · sweep · REAL-without-0007 · App Review Demo | 56/56 · 56/56 · 12/12 · 6/6 · 31/31 |
| Web · 7B two accounts `b7_web` · Two Truths `tt7_web` | 23/23 · 10/10 |
| Web · messaging `chat_test_6d` · group `m7_test` · 6C `c6_test_6d` | 38/38 · 80/80 · 69/69 |
| Node · 7A 90/90 · messaging 38/38 · 6C 56/56 · 7B 55/55 · Two Truths 14/14 | all pass |

**Covered by the 7B suites (unchanged):** view-once open once / second open refused / sender can't open / blocked / ended / paused / expired, no URL to reuse, and sender sees "Opened". See O1–O19 and Z8–Z11.

### Still needs two real phones

1. **iPhone:**
   - **Photo:** tap Photo → the picker appears (the dismissal timing).
   - **View-once:** same as Photo, plus Opened on the sender's phone once the other person opens it.
2. **Consent changes:**
   - **B turns photos ON** while A has the sheet open → A's rows unlock within about a second.
   - **B turns them OFF** → A's rows lock, and a photo already being picked is refused with the plain message.
3. **Interruptions during an upload:**
   - **Vibe ended** → "This Vibe is no longer active."
   - **Block** → refused (the upload is removed).
   - **Airplane mode** → "You're offline…", then the retry sends without uploading again.
4. **Server setup:** view-once needs 0008 applied and the `view-once` function deployed on your project.

## What you must do once

1. **Supabase → SQL Editor:** run `supabase/migrations/0008_phase7b_reliability.sql`.
   - Run it **after 0007**. It checks for 0007 first.
   - It runs in a single transaction, so a failure changes nothing.
   - It is idempotent; running it twice is safe.
   - **Never re-run 0001–0007 after it.**
2. **Supabase → Edge Functions:**
   - Deploy the new `view-once` function (`supabase/functions/view-once/index.ts`).
   - Redeploy `delete-account`: it now also removes After Dark card photos and private view-once files.
   - The header comment of each file has the steps.
3. **Optional but recommended: scheduled cleanup.**
   - Set an Edge Function secret `CRON_SECRET`.
   - Schedule a daily `POST {"action":"sweep"}` to `view-once` with the header `x-cron-secret: <secret>` (Integrations → Cron, or any scheduler).
   - The sweep deletes:
     - opened files that weren't deleted on the spot;
     - unsent or unopened files older than 14 days;
     - files in Vibes that ended or were blocked;
     - private files that nothing references.
   - It also expires stale Vibe requests and old events.
   - Without it, expiry still happens whenever either person opens After Dark.
4. **Realtime:** 0008 adds `user_events` to the `supabase_realtime` publication. Check it in Database → Publications.
5. **No new native modules.** The 7B changes are JavaScript only. TestFlight still needs a new EAS build, because 7A added `expo-audio` and Build 4 never receives OTA JavaScript.

## The three reported bugs: root causes and fixes

### 1. "No page found": a brand-new profile didn't open

- **Root cause:**
  - `/profile/[id]` looked the person up only in the phone's loaded world. People enter that world through content, World memberships and connections, so an account created minutes ago was never in it, and the screen decided "not found" from a local snapshot.
  - Search was also local only, so the new person couldn't be found.
- **Fix:**
  - A profile is never declared missing from the local snapshot. `usePeople.ensure(id)` fetches the person and adds them to the dataset (`realData.addPeople`).
  - Loading states:
    - **Loading…** while the first fetch runs.
    - **Still loading…** while retrying.
    - A missing profile is retried 3 times (0.6 s, 1.2 s, 2.4 s), because a new profile can briefly lag behind its id.
    - Transient failures are retried 3 times.
  - End states:
    - **"This profile isn't available"** only after the server confirms the profile doesn't exist.
    - **"Couldn't load … profile"** with **Retry** / **Go back** when offline.
  - Concurrent opens share one fetch.
  - A profile older than 60 s is re-fetched when the screen regains focus (stale cache).
  - **Server search:** `search_people` returns only onboarded people, never across a block, matched by username prefix or name. Its results are merged into Search.
  - A Back button now shows while a profile loads.

### 2. "Loading your profile: JWT issued at future"

- **Root cause:**
  - Supabase's API (PostgREST, error `PGRST303`) can briefly judge a token minted a moment ago as "issued in the future". This is a known, intermittent server-side clock/caching issue (supabase discussion #48123, PostgREST #5172).
  - The app showed the raw text ("Loading your profile: …") right after a successful verify.
  - Two further problems made it worse:
    - The OTP boxes' `onComplete` could fire twice (autofill + paste), which sent two verifies.
    - After a successful verify, a failure in the profile load cleared the code, so the person had to start over.
- **Fix:**
  - **Error classification** (`src/services/backend/errors.ts`):
    - `PGRST303`, `PGRST301`, `PGRST302` and network failures each get a kind and a plain message. No JWT, PGRST or policy text reaches the UI.
    - Our own short server sentences ("This request expired.") pass through. Raw policy messages ("violates row-level security…") never do; the security review caught 42501 passing through raw.
  - **Bounded retry** (`withRetry`, at 0.5 / 1 / 2 / 3.5 s) only for `jwt_future` and network errors. A real refusal (42501, a missing row) fails at once. There are no blind retries.
  - It wraps the profile bootstrap after sign-in and the world refresh.
  - **Clock skew:**
    - The device-vs-server skew is measured from a fresh token's `iat`; only the number is logged, never the token.
    - Beyond 120 s the message becomes "Your device time appears out of sync…" with how to fix it.
  - **OTP:**
    - Verify is single-flight: an identical code already in flight joins it.
    - A success is remembered for 2 s, so a second autofill/paste event can't resend it.
    - A failure is forgotten at once, so **Try again** really tries again.
    - After a verified code, a failed profile load keeps the screen and offers **Try again** without asking for a new code.
  - **Messages:**
    - An expired, wrong or superseded code: "That code didn't work or has expired. Check it, or request a new one." (Supabase reports all three as `otp_expired`, and a typo is the most common cause.)
    - Rate limits, invalid email and disabled sign-ups each have their own message.
    - Anything unmapped: "We couldn't finish signing you in. Try again."
  - **Diagnostics:** `[chimp:reliability]` lines in development builds only. They never contain tokens, OTP values or secrets.

### 3. A connection request arrived very late

- **Root cause:**
  1. There was no realtime signal for connections at all.
  2. Nothing refreshed relationships when the app came back to the foreground.
  3. An incoming request was visible only on the sender's profile: no list, no badge.
  4. `toggleConnect` was non-idempotent, so a double-tapped **Accept** became Accept and then Disconnect.
- **Fix:**
  - **`user_events`**, one private per-account feed of "something changed for you":
    - Written only by triggers; random UUID primary keys.
    - Readable only by its owner (RLS), and subscribed with `user_id=eq.<me>`.
    - A Realtime DELETE reveals nothing (`connections` itself is not published, because its PK is the user pair).
    - Events: connection request / accepted / updated, mutual Crush, relationship updated, Vibe request / accepted / updated, challenge your turn / completed, plan waiting / updated.
    - At most 30 events per sender per hour (`user_events_per_actor_hour`), so request/cancel loops can't flood someone. Nothing is lost: the app re-reads the real state on foreground and reconnect.
  - **`set_connection(other, action)`:**
    - Actions are explicit: request / accept / decline / cancel / disconnect.
    - Serialised per pair (advisory lock) and idempotent: a repeat returns the current truth.
    - A request when they already asked you → connected.
    - Blocks are respected.
    - Build 4's `request_connection` is unchanged and still emits events.
    - The old "connections insert/update" policies (which allowed forcing a "connected" row) are dropped. Build 4 only uses the RPC.
  - **Client intents** (`connectionAction`):
    - Optimistic, then the server's answer is applied as-is.
    - One request per person at a time: a second tap joins the first, so a triple-tapped Accept is one Accept.
    - A failure undoes only its own optimistic change and says why.
    - Disconnect asks first (native).
    - Every Connect button (profile, People cards, rows) now shows **Connect / Requested / Accept / Connected**.
  - **Requests on You:**
    - A **Connection request(s)** card with Accept / Decline, plus Decline on the sender's profile.
    - The You tab dot lights up for incoming requests.
    - A brand-new requester's profile is fetched, so the name is never "Someone".

## The reliability pattern (applied everywhere)

Every piece of shared state now follows the same recipe:

1. **Initial query**
2. **Realtime where it pays**
3. **Foreground reconcile**
4. **Reconnect reconcile**
5. **Idempotent mutations**

`src/services/live.ts` (REAL accounts only; Demo never touches Supabase) owns steps 2–4 for relationships and nudges After Dark:

- **Channel:** `events:<uid>` on `user_events` INSERT.
  - Events are nudges only. Their content is never trusted for anything security-relevant.
  - A burst of events is debounced (400 ms) into a single reload.
- **Reconcile:** re-reads connections, requests, Crushes, Sparks, blocks and follows (`fetchRelationships`) and applies them as the truth.
  - One reconcile runs at a time; a reconcile requested meanwhile is queued.
  - **No flicker:** if a Follow, Crush, Block or Connect of yours is still on its way, a snapshot that may predate it is discarded and re-read 1.5 s later.
- **Channel status:**
  - `SUBSCRIBED` (including the first subscribe) → reconcile (covers the gap between the world load and the subscription).
  - `CHANNEL_ERROR` / `TIMED_OUT` → status *reconnecting*; a quick catch-up after 3 s, then every 20 s until live again.
  - A channel that hasn't rejoined after 8 s is replaced. Late callbacks of replaced channels are ignored, so there is no resubscribe loop.
  - `CLOSED` under us → resubscribe with backoff (2, 4, 8, 15, 30 s).
- **Foreground** (AppState → active), in priority order:
  1. Relationships, if older than 5 s.
  2. After Dark, if it's open and older than 15 s.
  3. The full world, if older than 10 min.
- **Chat:** unchanged. It already had its own channel, a reconnect catch-up and a foreground catch-up (6B/7A).
- **After Dark:**
  - The Vibe channel now also listens to `chat_loops` INSERT/UPDATE (only loops in my Vibes trigger a reload).
  - It reports its channel status and reloads after a drop.
  - It exposes `refreshIfActive` / `noteEvent`.
  - A Vibe request that arrives while After Dark is closed sets a hint. After Dark still loads nothing until it's opened.
  - `respond` re-reads on failure, so an expired request moves to Ended instead of looking stale.

## Other changes (from the brief)

- **Pending Vibe requests expire:**
  - After 14 days (`app_settings.vibe_request_ttl_days`).
  - `respond_vibe` refuses an expired request with "This request expired."
  - `my_vibes()` closes the caller's stale requests and returns `expired`, shown as "This request expired." instead of "This Vibe has ended."
  - `request_vibe` closes a stale request between the pair before asking again.
  - The 7A rules (18+, blocks, Discover opt-in, origins, cooldowns) are unchanged; the security review checked them line by line.
- **Two Truths and a Lie** (a new challenge):
  - **Sending:**
    - Three free-text statements (1–120 characters each, cleaned on the server: control and invisible / direction characters removed, single spaces) and which one is the lie.
    - Only in an active Vibe with no block, and at most 3 waiting.
    - Only through `send_two_truths`; the regular `send_challenge` refuses it.
  - **Guessing:** a guess must be exactly one number 0–2 (a trigger). The sender's answer (the lie) is hidden by the 0007 RLS until the other person has guessed.
  - **UI:**
    - Compose: three inputs plus a LIE marker per row; Send stays off until everything is filled in.
    - The guess screen.
    - The reveal: "You fooled Maya" / "Maya spotted your lie", with the lie and the guess marked.
    - The result reads "The lie was spotted / got through", never a score.
  - The Demo plays it too (the Demo partner guesses).
- **View-once in production:** see the next section.
- **Media and voice consent, adversarial:** see the migration section and the security review.
- **Age:**
  - The server owns `age_set_at` and `age_bumped_at`.
  - A correction is allowed within 24 h of first setting the age; after that, only +1 once roughly a year has passed. Age can't be removed.
  - Cards from before 0008 count as set more than a day ago.
  - The card can no longer be deleted; that would have reset the clock.
  - **Self-declared age is still a limitation:** nobody verifies it. 18+ stays enforced server-side on every After Dark action.
- **Moderation foundation (no admin UI):**
  - `reports` gains status (open / reviewed / actioned / dismissed), `reviewed_at`, `reviewed_by` and `resolution_note`.
  - A new report is always *open*, whatever the app sends.
  - Reporters can read their own reports, but not the moderator's name or notes.
  - The `moderation` schema is reachable with the server key only:
    - `moderation.queue` shows each report with the Vibe status and how many reports the subject has.
    - `moderation.set_status(...)` sets a report's status.
- **Push foundation:**
  - `user_events` is the event source for CONNECTION_REQUEST, MUTUAL_CRUSH, VIBE_REQUEST, VIBE_ACCEPTED, CHALLENGE_YOUR_TURN and PLAN_WAITING_FOR_YOU.
  - MESSAGE_RECEIVED is reserved: chat has its own channel, so no message events are written yet.
  - Events carry ids only, never message text or romantic content. Future notification text must be generic ("Someone sent you a Vibe request").
  - No push is sent yet; that needs push tokens and an EAS build.

## View-once: production design

- **Storage:**
  - A **private bucket** `vibe-media` (images only, 10 MB).
  - The app may only upload into `once/<its own id>/`. There are no read, list, update or delete policies, so nobody can read these files through the API, the sender included.
  - **Restrictive** policies seal the bucket even if a broad storage policy is added to the project later.
- **Sending:**
  - The media row must be the sender's own file in their own `once/` folder.
  - A view-once message must use such a file, and only once. A normal photo can never use one.
  - Enforced by `messages_guard_8_media`, which runs after 0007's type checks and before the trigger that moves the file off the message.
- **Opening:**
  - The `view-once` Edge Function:
    1. Verifies the session (the user id comes from the token, never from the app).
    2. Calls `view_once_open_as` with the server key. The database decides: the recipient only, once, while the Vibe is active and nobody is blocked, and only the sender's own file in the sender's own folder. It records the opening.
    3. Downloads the file, deletes it, and marks it purged only if the delete succeeded.
    4. Returns the bytes once (base64), with only image MIME types.
  - There is never a URL, so there is nothing to reuse or share.
  - If the download fails (a storage hiccup), the opening is undone (`view_once_release`) and the person can try again. If the file is already gone, it's "no longer available".
  - 0007's `open_view_once` (which handed back a path) is revoked from the app.
- **Client:**
  - View-once photos are uploaded to the private bucket.
  - Opening calls the function and shows the image from memory (a data URI).
  - The tray says "View-once isn't set up on the server yet" if the function isn't deployed (ping).
  - **Screenshots can't be prevented** by any app, and the app says so.
- **Expiry and cleanup:** the scheduled sweep (above). A paused Vibe keeps its unopened photos.

## Migration 0008 (what it adds)

- **Settings:** `app_settings` (RLS on, no policies: server only) and `_setting_int`.
- **`user_events`** plus emitting triggers on `connections`, `crushes`, `vibes`, `vibe_challenges` and `chat_loops`, and `mark_events_seen`.
  - `_emit` skips: self, deleted accounts, blocked pairs, and senders over the hourly cap.
  - `purge_old_events` keeps 30 days.
- **Connections:** `set_connection`; the direct insert/update policies on `connections` are dropped. `search_people`.
- **Media:**
  - The `media` insert policy allows rows only in your own folders, a board you own, or your `once/` folder.
  - A poster must sit next to its video. No `..` in any path.
  - Pre-0008 posters outside their folder are cleared.
  - The `media` read policy: private rows are visible only to their owner; chat and After Dark rows to their owner and members of a conversation that uses them.
- **World teardown (`_world_teardown`, from 0005) redefined:** it deletes only media owned by the item's author (or the World owner, for the cover), and returns only paths inside their own folders.
- **View-once:**
  - The `vibe-media` bucket and its storage policies, `purged_at`, and a unique index (pre-0008 duplicates are de-duplicated first).
  - `messages_media_guard`.
  - Server-only functions: `view_once_open_as`, `view_once_mark_purged`, `view_once_release`, `view_once_sweep_candidates` (paths only inside the sender's folder; anything else is marked gone, never deleted) and `view_once_orphans`.
- **Vibes:** `_expire_pending_vibes`, `expire_stale_vibes`; `request_vibe`, `respond_vibe` and `my_vibes` redefined (`my_vibes` adds an `expired` column).
- **Two Truths:** `vibe_challenges.statements`, the kind and statement checks, `_clean_text`, `send_two_truths`, and the answer guard.
- **Age:** the age guard trigger plus clocks, a backfill, and separate select/insert/update policies (no delete).
- **Moderation:** report columns, the insert guard, column-level SELECT for the app, and the `moderation` schema (queue view, `set_status`).
- **Grants:**
  - Every new function is revoked from PUBLIC/anon first.
  - Only app functions are granted to `authenticated`.
  - Internal helpers and trigger functions are callable by nobody.
  - Server-only functions are granted to `service_role` only.

## Independent adversarial security review

A separate agent with no part in writing the code reviewed 0008, the Edge Functions and the client. It ran each exploit against local Postgres. All findings were fixed in 0008 or the function, and each has a regression test (Z1–Z17, F2b/F2c, F3a–c).

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| F1 | **High** | A media row's `poster_path` (and a post's `media_ids`) could point at someone else's file. Deleting a World then handed that path to the server-key storage delete, so another user's avatar could be deleted. | Poster must sit in the video's own folder, and no `..`. Teardown deletes only the item author's own media inside their folders. Planted posters are cleared. | Z1–Z4 |
| F2 | Medium | Age guard bypass: 0007's `FOR ALL` policy allowed delete + re-insert (resetting the age clock). Pre-0008 cards had no `age_set_at`, so any edit reopened the 24 h window. | No delete policy; clocks backfilled; no `updated_at` fallback. | Z5, Z6, F2b, F2c |
| F3 | Medium | 0008 failed (half-applied under `psql -f`) on 0007 data where one view-once file was sent twice. | De-duplicate before the unique index; the whole migration runs in one transaction. | F3a–c (0007 data → 0008 → re-run) |
| F4 | Medium | Event flooding (request/cancel loops, Crush toggles). | 30 events per sender per hour. | Z7 |
| F5 | Medium | Media rows planted before 0008 could make the sweep (or an open) delete someone else's file with the server key. | Open and sweep only act on the sender's own file in the sender's folder; otherwise the row is marked gone, not deleted. | Z8, Z9 |
| F6 | Low | Reports could be inserted as already "actioned" with a forged reviewer; reporters could read moderators' notes. | Insert guard; column-level SELECT. | Z14–Z16 |
| F7 | Low | Files that are never deleted (media row removed, unsent uploads); a failed delete still marked purged; a transient download failure lost the photo. | Orphan sweep; mark purged only on a successful delete; `view_once_release`. | Z10–Z12 |
| F8 | Low | The private bucket depended on no broad storage policy existing. | Restrictive seal policies. | Z13, Z13b |
| F9 | Info | Sender-claimed MIME returned as-is; invisible characters accepted as statements; raw 42501 text passed to the UI; paused Vibes lost unopened photos. | MIME allow-list in the function and the client; `_clean_text` strips them; policy text filtered; paused Vibes kept. | Z17, V4, O18 |

**Checked and held up (from the review):**
- **`user_events`:** private, can't be written by the app, random PK, blocks respected.
- **`set_connection`:** forcing, self-accept and block bypass are all closed; Build 4's RPC still works.
- **`search_people`:** wildcards stripped, minimum 2 characters, capped at 50, excludes non-onboarded and blocked people, no extra fields, not callable by anon.
- **View-once:** upload confined to your own folder; the recipient can't see the media row; open/sweep are not callable by the app; trigger order is correct.
- **Two Truths:** the lie is unreadable before guessing.
- **Vibe RPCs:** `request_vibe` / `respond_vibe` are identical to 0007 apart from expiry.
- **Hardening:** every SECURITY DEFINER function sets `search_path`; the moderation schema is not exposed.
- **Client:** no secrets in `src/`; `diag()` never logs tokens or OTP codes.

**Residual risks (documented, not fixed):**
- Hosted Storage uploading with an INSERT-only policy still needs checking on your project (step 2 of the two-phone script).
- Self-declared age.
- A sender's app chooses the stored MIME type (harmless now: the function and the client allow-list it).
- `search_people` hiding blocked people reveals that you were blocked (already visible through Build 4's `request_connection`).

## Files

**New (8):**
- `supabase/migrations/0008_phase7b_reliability.sql`
- `supabase/functions/view-once/index.ts`
- `src/services/backend/errors.ts`
- `src/services/backend/people.ts`
- `src/services/live.ts`
- `src/store/usePeople.ts`
- `src/hooks/useConnection.ts`
- `src/components/profile/ConnectionRequests.tsx`

**Modified (31):**
- **Screens:**
  - `src/app/_layout.tsx`
  - `src/app/(auth)/verify.tsx`
  - `src/app/(tabs)/you.tsx`
  - `src/app/profile/[id].tsx`
  - `src/app/search.tsx`
  - `src/app/after-dark/challenge/[id].tsx`
  - `src/app/after-dark/vibe/[id].tsx`
- **Components:**
  - `src/components/TabBar.tsx`
  - `src/components/profile/MatchCard.tsx`
  - `src/components/profile/PersonRow.tsx`
  - `src/components/afterdark/v2/ChallengesTab.tsx`
  - `src/components/afterdark/v2/VibeChat.tsx`
  - `src/components/afterdark/v2/VibesTab.tsx`
- **Data:** `src/data/afterDarkChallenges.ts`
- **Services:**
  - `src/services/afterDarkApi.ts`
  - `src/services/chatApi.ts`
  - `src/services/demoAfterDark.ts`
  - `src/services/demoChat.ts`
- **Backend services:**
  - `src/services/backend/afterDark.ts`
  - `src/services/backend/auth.ts`
  - `src/services/backend/chat.ts`
  - `src/services/backend/content.ts`
  - `src/services/backend/media.ts`
  - `src/services/backend/realData.ts`
- **Stores:**
  - `src/store/useAfterDark.ts`
  - `src/store/useChat.ts`
  - `src/store/useChimp.ts`
  - `src/store/useSession.ts`
- **Functions:** `supabase/functions/delete-account/index.ts`
- **Docs:** `BUILD_NOTES.md`, `README.md`

**Not modified:** migrations 0001–0007, `app.json`, `package.json`. No new packages and no native changes.

## Tested locally

All of this ran on local Postgres 16 (with a Supabase stub) and Chromium (web export) against a multi-user Supabase mock. Nothing ran on an iPhone, and nothing ran on your Supabase project.

| Suite | Result |
|---|---|
| TypeScript `tsc --noEmit` | clean |
| ESLint `expo lint` | clean (no new suppressions) |
| DB · 0008 suite `pg_7b_test.sql`: connections, events, search, Crush, After Dark events and expiry, view-once, media consent, Two Truths, age, moderation, security regressions Z1–Z17, grants, deletion | **112 / 112** |
| DB · security split runs (0007 data → 0008): F3 duplicate view-once + re-apply; F2 legacy cards | 3/3 · 2/2 |
| DB · older suites re-run on 0001–0008: 6D 62/62 · delete-world 34/34 · messaging 113/113 · chat 35/35 · 6C 19/19 · avatars 9/9 | all equal to their 0007 results |
| DB · `pg_rls_all_6d` | 35/37 on **both** 0007 and 0008 (two Spark-fixture checks fail identically before 0008: pre-existing, not 7B) |
| DB · 7A suite adapted to 0008 (uid-folder fixtures) | 110/115; the 5 are the intended view-once change (a public-bucket view-once is refused; the direct open is revoked) |
| Node · 7B reliability `b7.ts`: errors / retry / clock skew, OTP single-flight, connection intents (incl. triple-tap Accept), reconcile and live routing, stuck / closed channels, profile-by-id states, view-once client | **55 / 55** |
| Node · Two Truths + After Dark refresh `t7.ts` | **14 / 14** |
| Node · 7A `a7.ts` 90/90 · messaging `m7.ts` 38/38 · 6C `c6.ts` 56/56 | all pass |
| Web · **two accounts, two browsers** `b7_web.py` (Tests A–F below) | **23 / 23** |
| Web · Two Truths in the App Review Demo `tt7_web.py` (zero Supabase calls) | **10 / 10** |
| Web · After Dark `ad7_test` 56/56 · sweep 12/12 · REAL-without-0007 6/6 · App Review Demo `review_test` 31/31 | all pass |
| Web regression (dev build) · 6D 72/72 · 6C 69/69 · chat 38/38 · avatars 15/15 · delete-world 29/29 · 6C smoke 33/33 · re-entry cycles completed · Demo sweep 0 errors | all pass |
| Web · group messaging `m7_test` | 80/80 in 3 of 5 runs. The 2 other runs failed one timing-sensitive check ("owner leaving says who takes over" read 0.5 s after opening Group info, before the member list loaded). With a wait it passes; it passed in 7A. Logged as a flaky check, to watch on device. |

**Regression tests A–F** (web, two REAL accounts in two browsers):

- **A · profile by id:**
  - A brand-new account found by search opens through **Loading…** while its profile lags; "not found" never shows.
  - A profile that truly doesn't exist says so after about 4.4 s of retries, not instantly.
- **B · sign-in:**
  - `PGRST303` injected twice on the profile bootstrap → retried → signed in.
  - No JWT/PGRST text anywhere.
  - One verify request for one code.
- **C · connection request:**
  - Nova sends → Ana's You tab shows the request in **≈0.5 s** with Nova's name, no restart.
  - A double-clicked Accept sends **one** `accept`; both are connected on the server.
  - Nova sees **Connected** within moments.
  - Both reload → both still Connected.
- **D · drop:** Ana's socket is dropped, a request is made while she can't hear it → it appears within **≈3 s**.
  - That came from the quick catch-up. The mock's re-routed socket doesn't carry supabase-js's rejoin, so Supabase's own reconnect is for the phone test.
- **E · foreground:**
  - With Realtime silent, a request made while the page is hidden is not shown.
  - When the page becomes visible, it appears within **0.2 s**.
- **F · search:** server search finds a person who isn't in your world yet.

## Known limitations

- **Not yet on real phones or your Supabase project.** Realtime reconnect behaviour of supabase-js on iOS (background / foreground, network switches) is exactly what the two-phone script checks.
- **Push notifications:** only the event foundation exists. No tokens are stored and nothing is sent.
- **Self-declared age:** no verification.
- **Screenshots of view-once photos can't be prevented.** A photo opened while the response is lost in transit is gone (view-once semantics); a storage error before sending lets you retry.
- **Expiry and cleanup:**
  - Expiry of pending Vibe requests is lazy (when either person loads After Dark) unless the sweep is scheduled.
  - Old events and private files are removed only by the scheduled sweep.
- **Network changes:** there is no separate offline detector (`NetInfo` would need a native module). Offline is handled by Realtime status, foreground reconcile, and retries/Retry on screens.
- **Event cap:** at most 30 events per sender per hour. Beyond that the other person's phone catches up on foreground or reconnect rather than instantly.
- **Not yet idempotent:** Crush and Follow toggles still flip a flag and sync. The reconcile corrects them, and a reconcile never overwrites an in-flight change.
- **Group test flake:** `m7_test` has one timing-sensitive check (see above).

## Two-phone test plan (real Supabase project; needs the EAS build)

Use two iPhones (A and B) with accounts that are not each other's connections. Use a stopwatch.

1. **Setup:**
   - 0008 run with no errors (SQL Editor shows success). Run it a second time: still no errors.
   - `view-once` and `delete-account` deployed.
   - `user_events` in the realtime publication.
2. **View-once upload:**
   - B sends A a view-once photo in an active Vibe.
   - It must upload; this is the Storage INSERT-only check.
   - Supabase Storage → `vibe-media` shows the file under `once/<B>/`.
3. **New profile (Issue 1):**
   - B creates a brand-new account and finishes onboarding.
   - A searches B's username and opens the profile: **Loading…** then the profile, never "not found".
   - Also open B's profile from a link or id while A's app has never seen B.
4. **OTP (Issue 2):**
   - Sign in on B by **pasting**, by **iOS autofill from Mail**, and by **typing** (one at a time).
   - **Resend**, then try the old code ("didn't work or has expired"); the new code must work.
   - Try an expired code (wait about 1 h).
   - Set B's clock 10 min ahead (Settings → General → Date & Time, automatic off) → sign in → expect the clock message, not JWT text.
   - Restore the clock.
5. **Connection request (Issue 3), both apps open:**
   - B taps Connect on A → A's You tab dot plus the request card **within ~2 s**.
   - A double-taps Accept → B shows Connected **within ~2 s**.
   - Kill both apps and reopen: still connected.
6. **Backgrounded:**
   - A backgrounds the app. B disconnects and sends a new request.
   - A foregrounds → the request shows **within ~2 s of opening**.
7. **Network switches:**
   - A goes to Airplane mode for 30 s, then back on Wi-Fi, then cellular.
   - Meanwhile B sends a Vibe request and a challenge.
   - A catches up **within ~5 s** of the network returning, without a restart.
8. **After Dark sync (both 18+):**
   - Mutual Crush → both see "It's mutual".
   - Vibe request / accept, pause / resume / end / block: each side updates within seconds, with no stale active Vibe.
   - Two Truths: B sends, A guesses, both see the reveal.
   - A Plan proposed → the other sees "waiting on you".
9. **View-once:**
   - A opens B's photo once; a second open says "already opened".
   - B can't open their own. After blocking, it can't be opened.
   - Storage no longer has the file after it's opened.
10. **Moderation:**
    - Report from a Vibe.
    - In the SQL Editor, `select * from moderation.queue` (as postgres) shows it. `select moderation.set_status(...)` works.
11. **App Review Demo:** still works from Welcome, with no network needed.

## Phase 7C recommendations

- The UI redesign (deferred from 7B), with the requests card moved somewhere more prominent on You.
- Push notifications on top of `user_events`: tokens table, an Edge Function sender, generic text only, and user controls.
- Idempotent Crush and Follow intents (like `set_connection`).
- Schedule the sweep by default, and add a small moderation tool on the server key.
- Age assurance options, if After Dark grows.
- An offline indicator (`NetInfo`, in the next native build).

## Final status

| FEATURE / ISSUE | STATUS | TESTED LOCALLY? | TESTED REAL SUPABASE? | TESTED TWO PHONES? | NEEDS EAS BUILD? | READY FOR 7C? |
|---|---|---|---|---|---|---|
| Issue 1 · new profile opens (no "No page found") | Fixed | Yes (Node + web A, F) | No | No | Yes | Yes, after the phone test |
| Issue 2 · "JWT issued at future" / OTP | Fixed (retry + plain messages + clock skew) | Yes (Node + web B) | No | No | Yes | Yes, after the phone test |
| Issue 3 · late connection requests | Fixed (events + reconcile + requests UI) | Yes (Node + web C, D, E) | No | No | Yes | Yes, after the phone test |
| Idempotent connections (double-tap Accept) | Done | Yes (DB, Node, web) | No | No | Yes | Yes |
| Foreground / reconnect reconciliation | Done | Yes (Node, web D/E) | No | No | Yes | Yes, after the phone test |
| After Dark realtime (Vibes, challenges, Plans) | Done | Yes (DB events, Node, web suites) | No | No | Yes | Yes, after the phone test |
| Pending request expiry (14 days) | Done | Yes (DB, UI copy) | No | No | Yes | Yes |
| Two Truths challenge | Done | Yes (DB, Node, web Demo) | No | No | Yes | Yes |
| View-once production design | Done (bucket + function + sweep) | Yes (DB, Node) | No — function and storage untested | No | Yes | After the upload / open check |
| Media / voice consent revalidation | Done | Yes (DB) | No | No | No (server) | Yes |
| Moderation foundation | Done | Yes (DB) | No | No | No | Yes |
| Age hardening | Done (self-declared remains) | Yes (DB) | No | No | No | Yes |
| Push foundation (events only) | Foundation only | Yes (DB events) | No | No | Yes (for push) | Yes |
| Security review findings F1–F9 | All fixed + regression tests | Yes | No | No | No | Yes |
| 7B patch · photo / view-once consent (locked rows, server check, picker timing, plain errors) | Fixed | Yes (DB PH1–PH10, Node 19/19, web 36/36) | No | No | Yes | Yes, after the phone test |
| App Review Demo (local, zero Supabase calls) | Unchanged + Two Truths | Yes (31/31, 10/10) | n/a | No | Yes | Yes |

**Phase 7B is not complete until the two-phone script passes on your Supabase project.**


# Chimp build notes — v0.7A — After Dark v2 Foundation

1 Oct 2026 · branch `phase-7`.

`master` and the tagged TestFlight Build 4 (`testflight-0.1.0-build4`) are untouched. No commits were made: everything is in the `phase-7` working tree.

After Dark becomes a romantic interaction layer built on Chimp's own primitives (Crush, conversations, Open Loops, blocks, relevance context):

**Discover → mutual intent → Vibe → Challenges → conversation → Plans → a real date, or a clean goodbye.**

Real attraction. Mutual intent. Playful chemistry. Real plans.

## What you must do once

1. **Supabase → SQL Editor:** run `supabase/migrations/0007_phase7a_after_dark.sql`.
   - Run it **after 0006**. It checks for 0006 first.
   - It is idempotent; running it twice is safe.
   - **Never re-run 0001–0006 after it.** 0006's conversation-kind check and 0002's message-type check would reject the new `vibe` conversations and `voice` messages.
2. **New native build:** voice notes use `expo-audio`.
   - It is in Expo Go, so you can test there, but TestFlight needs a new EAS build.
   - `app.json` adds the expo-audio plugin with the microphone permission text.
   - There are no OTA updates in this project, so Build 4 never receives this JavaScript.
3. **Nothing else:** no Edge Functions, no new secrets, no service-role key in the app. RLS stays on everywhere.

## What changed (product)

- **After Dark tab:**
  - It goes 18+ confirmation → **your After Dark card** (age required once; a Demo card is seeded) → five top tabs.
  - The bottom bar (Boards / Buzz / Happening / You / After Dark) is unchanged.
  - The old "Inside After Dark" section grid (a copy of Boards) is gone from the tab. The After Dark *World* still exists as a World.
- **Discover:**
  - Large photo-first cards: tap through photos; first name, age, broad city, intent, interests.
  - **Why you may vibe:** Worlds you're both in, shared interests, mutual connections. Never a percentage.
  - Their **Open Loop** is on the card.
  - Actions:
    - **Pass**: private.
    - **Crush**: private, and it's the normal Chimp Crush.
    - **Respond** to their Open Loop, or **Send interest**: this asks for a Vibe, and they decide.
  - Only adults who switched on **Show me in Discover** appear there.
- **Crush and mutual Crush:**
  - Crush stays the private Chimp primitive.
  - A mutual Crush shows **It's mutual** (in Discover, on the Vibes tab, and on their profile's Spark card), with **Take it After Dark** or **Start normal chat**.
  - Nothing unlocks until the other person accepts the Vibe: no photos, no voice notes, no plans.
  - "Normal chat" stays in normal Messages. Taking it After Dark later creates a separate Vibe chat. The normal conversation is never copied or moved.
- **Vibes:**
  - Each Vibe is the pair ("You + Maya").
  - **Status:** Active / Pending / Cooling (quiet for 5 days) / Paused / Closed.
  - **Stage, in words only:** Curious → Spark → Building → Strong Vibe.
  - **One contextual next step:** "Maya is waiting on your answer", "A plan is waiting for a yes". Never "why haven't you replied", never last-seen.
  - **Cooling** offers **Keep it going / Close Vibe**.
  - Requests waiting on you come first, with how they started.
- **Challenges** (only inside a Vibe):
  - Six games: Same Brain, Would You Rather, Predict Me, Choose the Night, Fast Five, After Hours.
  - Filters: Incoming / Waiting on Them / Completed.
  - Both people answer privately; results show only after both have played, and become part of the Vibe.
  - Next steps afterwards: "Make this night a plan", "Play another", "Back to the chat".
  - No leaderboards; results are pair-level only ("4 of 5 the same").
- **Plans:**
  - Private to the pair.
  - Open Loop → **Proposed → Confirmed → Completed**, with **Paused / Closed** available any time.
  - Actions: **Accept · Tweak · Pause · Close**.
  - Whoever proposes or changes the time or place waits for the **other** person's yes.
  - Places are free text (a neighbourhood or venue), never a live location.
- **Inbox:**
  - One conversation per Vibe, separate from normal Messages (which never lists them).
  - The header shows how the Vibe started.
  - The timeline holds text, voice notes, photos, **view-once photos**, reactions and replies, plus the pair's Challenge, Open Loop and Plan cards.
- **Consent:** "the recipient of romantic interest controls the next level of access."
  - A Vibe is pending until the person who was asked accepts.
  - Each person decides what the other can send *them*: photos (off by default) and voice notes (on).
  - There is no gender anywhere in the data model.
- **Leaving:**
  - Every Vibe has **Pause / End / Block / Report**.
  - End reasons are private: Not feeling it / Timing isn't right / Looking for something different / Met someone / Other.
  - The other person sees only "This Vibe has ended."
  - After End or Block, neither person can message. The person who was ended on can't restart the Vibe.
- **Private Crush as a relevance signal:**
  - It is a tiny, silent weight in the shared social term used by Buzz, Happening, Worlds, Moves and Stories, and a +1 nudge in people suggestions.
  - It never adds a name or a reason, so nothing on screen can reveal it.
  - It is exposed as `privateCrushSignal()` for future Opportunity Graph work. No new ranking system.

## Migration 0007 (what it adds)

- **Reused:**
  - `conversations` (new kind `'vibe'`)
  - `messages` (type `'voice'`, plus `view_once` / `viewed_at` / `duration_ms`)
  - `chat_loops` (`plan_state` / `plan_at` / `plan_by`)
  - `crushes` / `my_sparks()`
  - `blocks`, `media` (kind `'audio'`), and the storage folder `afterdark/{you}/`
- **New tables:**
  - `after_dark_profiles`: opt-in card; age 18–99; Discover only if `discoverable`.
  - `after_dark_passes`: private.
  - `vibes`, `vibe_members`: each person's own `allows_photos` / `allows_voice`.
  - `vibe_closures`: private end reasons.
  - `vibe_challenges`, `vibe_challenge_answers`: the other person's answers are unreadable until both have answered.
  - `view_once_media`: the file behind a view-once photo; no policies, so nobody can read it.
  - `reports`.
- **Functions (security definer, `search_path` set, revoked from anon):**
  - Vibes: `request_vibe`, `respond_vibe`, `pause_vibe`, `resume_vibe`, `end_vibe`, `set_vibe_controls`.
  - Challenges: `send_challenge`, `answer_challenge`.
  - Other: `open_view_once`, `my_vibes`, `after_dark_discover`.
  - Internal helpers (`vibe_for`, `_romantic_open`, `is_blocked_between`) are not callable from the API.
- **Redefined (backwards compatible with the shipped Build 4):**
  - `can_participate`, the "messages send" policy and `my_conversations()` (which excludes Vibes).
  - The "media read" policy: chat and After Dark files are readable only by their owner and by members of a conversation that uses them.
- **Triggers:**
  - Message guard: media must be your own, of the right kind; the view-once fields are immutable.
  - The view-once file is moved off the message row.
  - Plan rules: only in Vibes; only the other person confirms; finished plans are frozen.
  - A **block closes any open Vibe** between the two people.
- **Realtime:** `vibes` and `vibe_challenges` are published, with random uuid keys and RLS applied.

## Architecture decisions and why

- **A Vibe's chat is an ordinary conversation of kind `'vibe'`**, not a new messaging system. It reuses messages, reactions, Open Loops, read state, RLS and Realtime as they already are.
  - Normal Messages (`my_conversations`) filters Vibes out, so Build 4 never sees them.
  - The chat store gained `claimConversations()`: After Dark claims its live messages, so the Messages list isn't reloaded for every romantic message.
- **Plans are Open Loops** with a plan state, and a resolved loop can become a plan. One table, one realtime path.
- **One API interface, two backends** (as with chat): `afterDarkApi.ts` (Supabase) and `demoAfterDark.ts` (in-memory, seeded).
  - The Demo applies the same rules as the server: gates, plan rules, view-once once, block → closed, the 7-day re-ask cooldown.
  - The Demo makes zero network requests.
- **After Dark loads lazily.** The store is bound to the account at launch but makes no request and opens no Realtime channel until After Dark is opened (or a mutual Crush is acted on).
  - Root cause: starting it eagerly added a channel and requests to every REAL session, which made the timing-sensitive messaging regression flaky. It is also more private.
- **View-once is a state model, not a secrecy guarantee.**
  - The server enforces recipient-only, open-once, and only while the Vibe is active.
  - The file reference lives in a table nobody can read.
  - **The file itself still sits in the public `media` bucket at an unguessable path.** Phase 7B: private bucket, signed one-time URLs, deletion after opening.
  - The app says "Screenshots can't be blocked."
- **Shared first names are disambiguated** ("Maya C." / "Maya T.").

## Independent security review (all fixed in 0007 and re-tested)

An independent agent probed 0007 against a local Postgres. Its findings, all fixed:

1. **(High) Photo/voice consent bypass:** media could be sent labelled as `text` or `voice`. Fix: the guard requires the media to be the sender's own and of the declared kind.
2. **(High) Vibe media readable by any signed-in user; unopened view-once file reachable through `messages.media_id`.**
   - Fix: "media read" restricted to the owner and to conversation members; chat and After Dark files are no longer listable.
   - The view-once file moved to `view_once_media`, which has no policies.
3. **(Medium) Plan self-confirm:** a note edit by the other person flipped the proposer. Fix: note and status edits keep the proposer; finished plans are frozen.
4. **(Medium) A mutual-Crush request carried text to someone who never confirmed 18+.** Fix: every request now needs the recipient's After Dark age (18+).
5. **(Medium-low) Challenges could be answered after a block.** Fixed.
6. **(Low) After a block a Vibe still looked "active".** Fix: a block now closes the Vibe; the blocked person sees "This Vibe has ended."
7. **(Low) View-once could be opened after End or Block.** Fixed.
8. **(Low) Request spam and lockout:** a requester could withdraw and re-ask indefinitely, and a withdrawn request could lock the other person out. Fix: the pair's latest Vibe decides, with a 7-day cooldown after withdrawing.
9. **(Low) Card photos from another user's folder.** Fix: card photos must come from `afterdark/{you}/`.
10. **(Low) Reports could probe other people's Vibes.** Fix: a report can only reference your own Vibes and messages.
11. **(Low, from 0002) Anyone could ask whether two people had blocked each other.** Fix: `is_blocked_between` is revoked from API roles.

## Files

- **New:**
  - `supabase/migrations/0007_phase7a_after_dark.sql`
  - `src/services/backend/afterDark.ts`, `src/services/afterDarkApi.ts`, `src/services/demoAfterDark.ts`
  - `src/store/useAfterDark.ts`, `src/utils/afterDark.ts`, `src/data/afterDarkChallenges.ts`
  - `src/components/afterdark/v2/`:
    - `adTheme.ts`, `useAdData.ts`, `VibeParts.tsx`
    - `AfterDarkHome.tsx`, `DiscoverTab.tsx`, `VibesTab.tsx`, `ChallengesTab.tsx`, `PlansTab.tsx`, `InboxTab.tsx`
    - `VibeChat.tsx`, `VoiceNote.tsx`, `DisconnectSheets.tsx`, `MutualCrushSheet.tsx`, `CardEditor.tsx`, `SparkActions.tsx`
  - `src/app/after-dark/vibe/[id].tsx`, `src/app/after-dark/challenge/[id].tsx`, `src/app/after-dark/card.tsx`
  - `assets/demo/after-dark-voice.mp3`: the Demo voice note, 7 s, synthesised.
- **Changed:**
  - `src/app/(tabs)/after-dark.tsx`: gate → card → v2 home.
  - `src/app/_layout.tsx`: routes, plus binding After Dark to the account.
  - `src/app/profile/[id].tsx`: Spark card actions.
  - `src/app/settings.tsx`: Demo reset includes After Dark.
  - `src/services/backend/chat.ts`: voice, view-once, `openViewOnce`, plan fields.
  - `src/services/backend/media.ts`: `uploadAudio`, the `afterdark` folder.
  - `src/services/chatApi.ts`, `src/services/demoChat.ts`: Vibe conversations and gates, view-once, voice, plan rules.
  - `src/store/useChat.ts`: voice, view-once, `claimConversations`.
  - `src/graph/config.ts`, `src/graph/relevance.ts`: the silent private-Crush signal.
  - `app.json` (expo-audio plugin), `package.json` / `package-lock.json` (`expo-audio ~57.0.5`).
  - `BUILD_NOTES.md`, `README.md`.

## Tested locally (web + local Postgres; not on an iPhone, not on your Supabase project)

- **SQL** (local Postgres 16; 0001 → 0007, then 0004–0007 re-applied to prove re-runs are safe):
  - **Phase 7A suite: 115/115.**
    - Discover, Crush privacy, mutual Crush → Vibe.
    - Pending / accept / decline.
    - Consent gates for photo, voice and view-once.
    - Challenges, with answers hidden until both have played.
    - Open Loop → Plan rules, Pause / End / Block, reports, direct-write refusals.
    - Account deletion, Realtime and grants.
    - 19 regression tests for the security-review findings (S1–S19).
  - **Earlier suites, re-run on 0007:**
    - Messaging 113/113, chat 35/35, 6D 62/62, avatar 9/9.
    - Delete-world 34/34, 6C 19/19 and RLS 24 pass: these have the same known fixture errors / 2 known fixture FAILs as before 0007.
- **Independent security review** (a separate agent, adversarial, against local Postgres): 11 findings. All are fixed, and each has a regression test.
- **Node** (the real app modules):
  - After Dark data layer 90/90: Demo backend + store, gates, plans, view-once, lazy loading, the silent Crush signal.
  - Messaging 38/38, 6C 56/56.
- **Web** (Playwright, App Review Demo on a build configured for a mock Supabase that records every request):
  - **After Dark end to end: 56/56 at 390×844 and 430×932** (also 56/56 at 375×667 before the last layout tweak):
    - 18+ gate; Discover (photo tap-through, Why you may vibe, Crush → It's mutual → Take it After Dark → pending → accepted; Respond; Pass).
    - Vibes (Cooling → Close Vibe with a private reason; accepting a request).
    - Challenges (play → result → next steps), Plans (Accept, Open Loop → plan).
    - Inbox and the Vibe screen (voice note, view-once open-once, tray, controls, Pause/Resume, Report, Block).
    - Normal Messages without Vibe chats.
    - **Zero Supabase requests** throughout.
  - **Route sweep: 19 After Dark routes (including bad ids) × 3 sizes: 12/12.** No horizontal overflow, "isn't available" for bad ids, no page errors, no Supabase calls.
  - **App Review Demo regression: 31/31.**
  - **REAL account smoke: 6/6.** No After Dark request or channel until After Dark is opened; without 0007 on the server you get the card setup, never a crash; Messages unaffected.
- **Web regression:**
  - 6D 72/72, 6C 69/69 (dev build), 1:1 chat 38/38, avatar 15/15, delete-world 29/29, REAL smoke 33/33, messaging 80/80.
  - REAL → Demo → REAL cycles completed with 0 page errors; Demo route sweep 0 errors.
  - **Root cause found on the way:** with After Dark starting eagerly in every REAL session, the messaging suite's "B gets A's message within 2.5 s" check failed twice. After Dark now loads only when opened, and the suite passes 80/80.
  - The suite's known 1:1 Same Brain 30-second timing check still flaked once on a rerun.
- **Checks:** TypeScript 0 errors, ESLint clean. Client RPC names and parameters were checked against the SQL signatures.
- **Not tested here:** an iPhone, your Supabase project, real microphone recording, and voice playback on a device (the web harness can't record audio).

## Known limitations (7A)

- **View-once:** see above. The file stays in the public bucket (unguessable path) until 7B. Screenshots can't be prevented.
- **Age is self-declared** (18–99). There is no verification yet.
- **Two Truths** isn't in yet: it needs free-text statements, while answers are option numbers today. It's in 7B.
- **No push notifications:**
  - Mutual Crushes, requests and challenges show inside the app (tab dots, cards).
  - Loop and plan changes in a Vibe you don't have open appear the next time After Dark refreshes (opening a tab or the Vibe). There's no polling.
- **Demo only:** the other person accepts your request or answers your challenge after about 6 seconds, so the whole loop can be tried.
- **Report:** reports are stored, but there's no moderation queue yet (7B).
- **Profile links:** in REAL, a person who isn't in your loaded world has no profile page to open from After Dark. Their names still load.

## Still to check on a real iPhone (new EAS build) and your Supabase project

1. Run 0007 on the project; confirm it finishes without errors. Run it a second time; it should still be fine.
2. **Two REAL accounts (A, B), both open to dating:**
   1. Each enters After Dark → card (age) → A switches on **Show me in Discover**.
   2. B sees A in Discover → **Respond** → A sees **Waiting on you** → Accept.
   3. Both are in the Vibe chat live (Realtime).
3. **Mutual Crush:**
   - Crush each other from profiles → **It's mutual** on both phones.
   - **Start normal chat** stays in Messages.
   - **Take it After Dark** → pending → accept → a separate Vibe chat. The normal chat is unchanged.
4. **Voice note:**
   - The first tap asks for the microphone.
   - Record → send → the other phone plays it (also in silent mode).
   - Turn **Voice notes** off in controls → the mic is refused.
5. **Photos and view-once:**
   - Photos are refused until the recipient turns them on.
   - View-once → the recipient opens it once → "Opened" on both phones → it can't be reopened.
6. **Challenges:** send → play on both phones → the result appears on both → "Make this night a plan".
7. **Plans:** propose → only the other person can Accept → Tweak goes back to the other person → Pause / Close.
8. **Leaving:**
   - Pause (the other phone sees it's paused).
   - End with a reason (the other phone sees only "This Vibe has ended.").
   - Block from a Vibe (the Vibe closes for both).
   - Report.
9. Normal Messages never shows Vibe chats, on either the new build or **Build 4**.
10. **App Review Demo:** After Dark → 18+ → the whole seeded flow works with no sign-in.
11. Layout on iPhone 12 and 15 Pro Max: Discover card plus actions above the tab bar; the keyboard with the Vibe composer.

## Phase 7B recommendations

- **View-once for real:**
  - A private bucket, and signed one-time URLs issued by `open_view_once`.
  - Server-side deletion of the object after opening or expiry; the `view_once_media.opened_at` rows are the cleanup queue.
  - On iOS, a screenshot notice.
- **Age assurance** beyond self-declaration, and a moderation queue for `reports` (with block/report analytics).
- **Push** for: a request waiting on you, a mutual Crush, your turn in a challenge, a plan waiting for a yes. Respect quiet hours.
- **Two Truths:** free-text challenge items, with server-side reveal rules.
- **Realtime for loops and plans across Vibes** (one channel on `chat_loops` filtered to my Vibe conversations).
- **Opportunity Graph v2:** use `privateCrushSignal()` and After Dark activity as private, low-weight edges; never surface them.
- Optionally, auto-expire long-pending requests (for example after 14 days).

---

# Chimp build notes — TestFlight App Review access patch

1 Oct 2026 · Apple rejected the first external TestFlight build under Guideline 2.1(a): the reviewer couldn't get into the app (sign-in needs a code sent to an email they don't have). This patch gives App Review a way in **without changing how real people sign in**. It isn't a feature and it isn't Phase 7. The messaging-patch notes follow below.

## What changed

- **Welcome:** under **Continue with Email** there's a small secondary action, **App Review Demo** ("Sample account with demo data · no sign-in"). It's in every build, TestFlight and App Store included.
- **App Review Demo** opens the existing seeded Demo (WollyMc's world), reset to its seeded state:
  - **No Supabase user is created.** There's no sign-in and no OTP; nothing is stored in Supabase Auth.
  - **No developer privileges:** no developer tools, Graph Debug is closed, no "Enter Demo Account".
  - **No real-user data:** the Demo's people, Worlds, posts and chats are fixtures on the phone. The test run made **zero** requests to Supabase during the whole Demo session.
  - **REAL and Demo stay isolated:** the Demo uses its own local store and dataset, and the in-memory Demo chat backend.
- **"Exit App Review Demo"** sits in a slim blue banner across the top of every screen, and also in Settings. It goes back to Welcome.
  - The banner sits **above** the app, not over it, so it never covers a header or a button.
  - Relaunching Chimp inside the App Review Demo keeps the banner.
- **What a reviewer can explore:**
  - Boards, with "Created by …" and members
  - Buzz: For You / Following / Trending / Drift
  - Happening
  - You and profiles
  - Messages: the "Niagara crew" group with reactions, Same Brain, Ping and Open Loops, plus 1:1 practice chats
  - Stories
  - After Dark (behind its 18+ gate)
  - Posting
- **New in the Demo:**
  - **Edit and delete your own posts.** Buzz you post in the Demo can now be edited (1 hour) and deleted from its ••• menu, locally.
  - **A short video that really plays.** The Demo's videos used to be still previews. One 8-second clip is now bundled with the app (an original Chimp-branded animation, 190 KB, H.264). It's first in Buzz → Drift and plays there and in the Drift viewer.
- **Normal sign-in is unchanged:** Continue with Email → 6-digit code → your account. The developer's own "Enter Demo Account" (Settings) still returns to their account afterwards. The App Review Demo always returns to Welcome.
- **No secrets in the app, no RLS changes, no migration.**

## For App Store Connect → TestFlight → Test Information → Review notes

> Chimp signs people in with a one-time code sent to their email, so it can't be reviewed with a shared password. To review the app, tap **App Review Demo** on the Welcome screen (below "Continue with Email"). It opens a complete sample account with demo data, with no sign-in. All main features work there: Boards, Buzz (For You / Following / Trending / Drift, with a short video), Happening, profiles, Messages (group chat, reactions, Ping, Open Loops), Stories, After Dark (18+ gate) and posting / editing / deleting your own posts. Nothing in the demo is sent to our servers. Tap **Exit App Review Demo** (top of every screen) to return to the Welcome screen.

## Files

- **New:**
  - `src/components/AppReviewBanner.tsx`: the banner, and the frame that places the app below it.
  - `assets/demo/drift-demo.mp4`, `assets/demo/drift-demo-poster.jpg`: the bundled clip.
- **Changed:**
  - `src/app/(auth)/welcome.tsx`: the App Review Demo action. The unconfigured-build "Explore the Demo account" link is replaced by it.
  - `src/store/useSession.ts`: `reviewDemo`, `enterReviewDemo()` (fresh seeded Demo, never a developer), `exitReviewDemo()` (→ Welcome), relaunch keeps the banner.
  - `src/app/_layout.tsx`: the banner frame.
  - `src/app/settings.tsx`: "Exit App Review Demo"; no developer section in it.
  - `src/app/graph-debug.tsx`: closed in the App Review Demo.
  - `src/services/backend/ownContent.ts`, `src/components/buzz/BuzzCard.tsx`, `src/app/edit-buzz/[id].tsx`: Demo edit/delete of your own posts.
  - `src/data/drift.ts`, `src/types/models.ts`, `src/graph/surfaces.ts`, `src/components/media/ChimpVideo.tsx`, `src/components/drift/DriftPager.tsx`, `src/app/drift/[id].tsx`: the playable bundled clip.
  - `BUILD_NOTES.md`, `README.md`.

## Tested locally (web; not on an iPhone or in TestFlight)

- **App Review Demo, on a build configured for a (mock) Supabase project: 31/31.**
  - Welcome still leads with Continue with Email.
  - App Review Demo → Buzz with the banner, with no auth token stored.
  - Every surface listed above opens, with the banner on each; the World shows provenance.
  - The bundled clip is a real `<video>` and plays (advances).
  - Post → edit ("Edited") → delete in the Demo.
  - Settings has no developer tools; Graph Debug is closed.
  - **No Supabase request of any kind during the Demo** (no auth, no reads, no writes).
  - Relaunch keeps the banner. Exit → Welcome with the flags cleared; relaunch stays on Welcome.
  - Normal Email + code sign-in works afterwards, without the banner.
  - Test-browser note: Playwright's Chromium can't decode H.264, so the test serves the same clip as VP9. The app ships the H.264 MP4, which iPhones play.
- **Regression:**
  - web: 6D 72/72, 6C 69/69, 1:1 chat 38/38, avatar 15/15, delete-world 29/29, REAL smoke 33/33, messaging 80/80, REAL → Demo → REAL → logout cycles ×3 completed
  - Demo route sweep (entering through App Review Demo): 0 errors
  - Node: 56/56 and 38/38
  - One timing check in the messaging suite (1:1 Same Brain within 30 s) missed once while everything ran back to back, then passed 80/80 on a rerun.
  - The only console noise is React Native Web's known "nested <button>" warning in Buzz/Drift.
- **Checks:** tsc 0 errors, ESLint clean.

## Still to check on a real iPhone (TestFlight build)

1. Fresh install → Welcome shows **App Review Demo** under Continue with Email.
2. Tap it → Buzz. The blue banner sits **under** the status bar, and no screen has a double gap or a hidden header. Check Buzz, Boards, Happening, You, Messages, a chat, Settings.
3. Buzz → Drift: the first item is the 8-second Chimp clip, and it **plays**.
4. Post a Buzz, edit it, delete it.
5. Force-close and reopen: still in the Demo, with the banner.
6. **Exit App Review Demo** → Welcome. Continue with Email still sends a code and signs you in normally.
7. Paste the review note above into App Store Connect and resubmit.

---

# Chimp build notes — final pre-TestFlight messaging patch

28 Sep 2026 · Code in `C:\Users\AI Admin\Documents\Chimp` · Expo SDK 57, Expo Router, TypeScript, Zustand, Supabase. Still Expo Go: one new package, `expo-clipboard`, which is part of Expo Go (no custom build). Phase 7 hasn't started. The v0.6D notes (with 6D.1 and 6D.2) follow below.

This patch makes Chimp's messages social rather than just 1:1.

| Area | What's new |
|---|---|
| **Group chats** | Messages → 👥 **New group**: pick people (you + at least 2) → name → optional photo → Create. The header shows name, photo and member count; tap it for **Group info**. |
| **Group info** | Name, photo, members with Owner / Admin badges, shared Worlds, Open Loops, Leave. **Owner:** rename, change photo, add, remove, make / remove admin, delete the group. **Admins:** rename, photo, add people, remove members. |
| **Reactions** | Long-press a message: ❤️ 😂 🔥 👍 😮 😭. Real counts under the bubble; tap a count to add or remove yours. |
| **Same Brain** | When both of you (1:1, within 30 s) or 3+ people (group, within 90 s) pick the same emoji: **"😂 × 4 ⚡ Same Brain"**, a small burst and a haptic, once. No scores, no streaks. |
| **Mutual Ping** | ✨ in the message box: Free tonight, Food?, Hang out, Call?, Need advice, Thinking about you, or Custom. **Private.** It's only revealed if it matches: the other person (1:1), or 2+ others (group), within 24 h. |
| **Open Loops** | Long-press → **Turn into Open Loop**. "Open Loops · N" at the top of the chat. Anyone in the chat can edit, date, place, resolve and reopen. **Create World** turns one into a private World you own. |
| **Group Chemistry** | A small "Chemistry ↑" strip on group chats. Tap it for a short card of plain facts. No AI. |
| **Also** | Reply (quote), Copy, Delete (unsend) from the long-press menu. The Demo account gets a seeded group chat, "Niagara crew". |

## What you must do once (for this patch)

1. **SQL:** run `supabase/migrations/0006_messaging_chemistry.sql` in the SQL Editor, **after 0005**.
   - It's safe to run again.
   - 0001–0005 are not edited.
   - If you ever re-run 0002, 0004 or 0005, run 0006 again afterwards. They define older versions of `my_conversations`, `prepare_account_deletion` and the "messages send" policy.
2. **Package:** in the project folder run `npx expo install expo-clipboard`. It's used for **Copy** and is included in Expo Go.
3. **Edge Functions:** nothing to redeploy. `delete-account` calls the updated database function, whose result has the same shape.
4. Restart with `npx expo start -c`.

Realtime needs no settings: 0006 adds the new tables to the `supabase_realtime` publication. It deliberately does **not** add `mutual_pings`.

## How it works

### Group chats (extends the 6B tables; no second chat system)

- **Schema:**
  - `conversations.kind` is `'direct'` or `'group'`, with `title`, `avatar_media_id` / `avatar_url` and `created_by`.
  - `conversation_members.role` is `owner`, `admin` or `member`.
  - Messages, unread, optimistic send + retry, photos and Realtime are the same code paths as 1:1.
- **Who can read:**
  - Only active members can read the group, its members, messages, reactions, Same Brain, matches and loops. This is enforced by RLS (`is_conversation_member`).
  - Someone who **left or was removed** loses access at once.
  - Their app hears it: a new policy lets you read **your own** membership row, so Realtime tells them and the group disappears.
- **Changes go only through checked functions:**
  - `create_group`, `update_group`, `add_group_members`, `remove_group_member`, `set_group_role`, `leave_group` and `delete_group`.
  - Each one checks `auth.uid()` and the caller's role.
  - Titles are 1–60 characters. A group is you plus 2–49 others.
- **Who can be added:**
  - Only people you can already message.
  - People you're connected with (or who follow each other with you) join as members.
  - Others (if they allow message requests) join as a **request**. The group sits in their Requests with **Accept**; replying accepts it; **Decline** leaves the group.
  - Blocked people (either way) can't be added.
  - Blocks still stop 1:1 messages, but don't lock anyone out of a whole group.
- **When someone leaves:**
  - If the owner leaves, the longest-standing admin becomes owner, or else the longest-standing member.
  - A group with no active member left is deleted.
  - Leaving also deletes your unmatched Pings there.

### Account deletion and group chats (the retention policy)

- **1:1 chats:** deleted for both people, as in 6D.
- **Groups survive.** The deleted person is removed; ownership passes on (same rule as leaving); the group is deleted only if nobody active is left.
- **Their group messages are deleted** (6D's rule: no tombstones, no "deleted user" ghosts).
  - Replies that quoted them lose the quote, not the reply.
  - The chat-list preview moves back to the latest remaining message.
- **What they created stays with the group:** Open Loops (they belong to the conversation; the creator becomes blank). A group photo they uploaded is cleared.
- **Their reactions** go. A Same Brain that already happened stays (it's an event, not a score).
- 0005's World deletion and hand-on logic is carried over **exactly**.

### Reactions + Same Brain

- **Where they live:** `message_reactions` (one row per person, message and emoji), written only by `react()`.
  - It checks membership.
  - Deleted messages can't get new reactions.
  - Only the six emojis are allowed.
- **When it fires:** `react()` decides Same Brain **on the server**, at the moment of reacting.
  - 1:1: 2 people within 30 s.
  - Groups: 3+ distinct members within 90 s.
  - It writes one `same_brain_events` row per message + emoji (unique), so there's never a second one. Removing and re-adding doesn't replay it.
- **Every phone shows the same thing:** they all read the same event row.
- **The animation plays once:** only where it's happening now (within 15 s), and never again on that phone.

### Mutual Ping (private intent)

- **Private by default:**
  - `mutual_pings`: RLS lets you read and cancel **only your own**.
  - There are no insert or update policies; only `send_ping()` writes.
  - It's not published to Realtime.
  - So nobody's app can ever see anyone else's hidden Ping.
- **How matching works:** `send_ping()` does it on the server.
  - It first drops expired Pings, and your own earlier unmatched Ping (a new one replaces it).
  - Then it looks for compatible live Pings from active members:
    - Same type always matches.
    - Free tonight ↔ Food?, Free tonight ↔ Hang out, Food? ↔ Hang out.
    - Call? ↔ Need advice, Call? ↔ Thinking about you.
    - Custom matches only the same words.
  - In a group, everyone in the match must be compatible with each other.
  - 1:1 needs both of you; a group needs 3+.
- **What everyone sees:** a match writes a `ping_matches` row (types + who), which the chat's members see.
  - 1:1: "Looks like you two might want to do something tonight." (or "…want to talk.").
  - Group: "Something could happen tonight. 4 people are interested." with their avatars.
  - Actions: **Make a plan** (starts a message), **Open chat**, **Create Open Loop**.
- **Expiry:** Pings expire after 24 h and disappear.

### Open Loops (table `chat_loops`)

- **Why the name:** 0001 already has a personal `open_loops` table (the You screen), which is untouched.
- **Fields:** title, note, status open/resolved, `target_date`, `location_text`, optional source message, optional linked World.
- **Rules:**
  - All members can read and edit.
  - The creator, or the group owner/admin, can delete.
  - A guard trigger keeps the conversation and creator fixed and sets `resolved_at` from the status.
  - It only lets you link a World **you own**.
- **Create World:**
  - Opens the normal New World composer, prefilled with the loop's title and set to **Private**. You can choose Connections instead; Public isn't preselected.
  - You're the owner.
  - Afterwards the loop links to the World and you land on its **People** tab.
  - Nobody from the chat is added automatically (Follow ≠ Join still applies).

### Group Chemistry (deterministic, in the app)

Computed from rows every member can already read, recalculated as things change:

- **Active today:** "N of M active today" (who wrote in the last 24 h).
- **Consensus:** "👍 consensus forming (n)", when 2+ people chose the same emoji on a recent message that isn't already a Same Brain.
- **Same Brain:** "Same Brain ×N this week".
- **Open Loops:** "<loop> still open · N more".
- **Ping momentum:** "N up for tonight" / "N want to talk". This comes **only from revealed matches**; hidden Pings are never an input (the app can't read them).
- **Shared Worlds:** "<World> · N of you are in it", from the member lists the app already has.

The strip reads **Chemistry ↑** with 3+ signals, **Chemistry** with fewer, and **Chemistry · quiet** with none.

### Security fixes found along the way (in 0006)

- **Messages can only be unsent.** 0002's "messages unsend" UPDATE policy only checked the sender. A modified client could have rewritten its own messages or **moved one into another conversation, e.g. a group it isn't in**. A guard now allows exactly one change, unsending, and blanks the words and photo.
- **Realtime DELETE events carry only a random id.** Supabase sends DELETE events to every subscriber with just the primary key. `conversation_members` was keyed by (conversation, user), so deleting a group or an account could have told other listeners who was in which chat. It now has a random `id` key. All Realtime tables are keyed by random ids (tested).

An **independent security review** of 0006, by a separate agent that tried exploits on a scratch database, found 8 more gaps before shipping. All are fixed and have tests:

- **Blocks in a 1:1:** reactions, Open Loops and Pings are refused while either person has blocked the other. People who declined can't use them either.
- **Declining a group invite** now means leaving it. Before, a "declined" member could still read the group.
- **Re-added members:** removing someone deletes their unmatched Pings, and Pings from before someone was (re-)added never count. An old hidden intent can't resurface.
- **Message timestamps:** a new message's time is set by the server. No future-dated "always unread" messages, no backdating, no arriving already "edited" or "unsent", no empty messages.
- **Group size:** the 50-person limit is enforced when adding people too, not only at creation.
- **Same Brain** counts only people still in the group.
- **Simultaneous Pings and reactions:** they're decided one at a time per chat (a row lock), so two compatible Pings sent in the same instant still match (tested with two parallel sessions). Ownership hand-over only ever picks an active member.
- **`conversation_kind()`** tells a non-member nothing (it can't be used to probe conversation ids).

One low-risk edge case is left, listed under Known limitations.

### Demo

- The Demo account has its own in-memory chat backend (`src/services/demoChat.ts`), with the same rules as the server.
- It's seeded with **"Niagara crew"** (you, Maya, Zara, Leo), which has:
  - a Same Brain,
  - a 👍 consensus,
  - Maya's and Zara's hidden Pings (so a compatible Ping from you reveals a group match),
  - an open and a resolved loop.
- Nothing touches Supabase, and REAL and Demo never share state.
- **Settings → Reset demo data** resets it.
- Demo 1:1 practice chats are unchanged.

### Files

- **New:**
  - `supabase/migrations/0006_messaging_chemistry.sql`
  - `src/services/chatApi.ts`, `src/services/demoChat.ts`, `src/utils/messaging.ts`
  - `src/components/chat/ConversationBody.tsx`, `ChatBubble.tsx`, `ChatComposer.tsx`, `MessageMenu.tsx`, `PingSheet.tsx`, `RevealCard.tsx`, `LoopsSheet.tsx`, `ChatStrips.tsx`, `PeoplePicker.tsx`, `useGroupChemistry.ts`
  - `src/app/new-group.tsx`, `src/app/group/[id].tsx`, `src/app/group-info/[id].tsx`, `src/app/group-add/[id].tsx`
- **Changed:**
  - `src/services/backend/chat.ts`: groups, reactions, Pings, loops, per-chat Realtime.
  - `src/store/useChat.ts`: one store for REAL and Demo.
  - `src/components/chat/RealChat.tsx`: 1:1 uses the shared chat body.
  - `src/app/messages.tsx`: group rows, New group, Demo.
  - `src/app/_layout.tsx`: routes, Demo chat.
  - `src/app/create/world.tsx`: prefill from a loop.
  - `src/app/settings.tsx`: reset the Demo chat.
  - `src/app/(tabs)/you.tsx`: Messages in Demo.
  - `package.json`: `expo-clipboard`.
  - `BUILD_NOTES.md`, `README.md`.

## Tested locally (not on your Supabase project or iPhone)

- **Postgres, 0001–0006** (0004–0006 re-run to check idempotence): **113/113**, including 15 for the review fixes. Covers A–AJ at the database level:
  - **Groups:**
    - create (needs 2 others, can't add who you can't message);
    - outsider can't read, send or see members;
    - rename and add (owner/admin only);
    - remove (admin can't remove the owner);
    - roles;
    - leave, with owner hand-over;
    - delete (owner only);
    - removed members lose access;
    - 1:1 unchanged.
  - **Reactions / Same Brain:**
    - 3 in 90 s → exactly one event;
    - outside the window → none;
    - 1:1: 2 in 30 s;
    - deleted messages refuse reactions;
    - outsiders can't react.
  - **Pings:**
    - hidden (nobody else can read them);
    - 1:1 compatible → match, incompatible → waits;
    - group needs 3;
    - custom only matches the same words;
    - expired Pings disappear;
    - no direct insert or update.
  - **Loops:**
    - members only;
    - the source message must be in the same chat;
    - resolve / reopen;
    - only a World you own can be linked;
    - delete rights.
  - **Messages:**
    - can't be moved or rewritten, only unsent (once);
    - unsend blanks the content and fixes the preview;
    - replies can't quote another chat.
  - **Account deletion with groups:**
    - 1:1 deleted;
    - the group survives with a new owner;
    - their messages are gone and others' stay;
    - the loop stays;
    - an emptied group is deleted;
    - the Auth user deletes cleanly.
  - **Realtime:**
    - `mutual_pings` not published;
    - every published table keyed by a random id.
- **Earlier SQL suites on 0006**, all the same as their baselines: 6D 62/62, delete-world 34/34, chat 35/35, avatar 9/9, 6C 19/19, and 6A RLS with its 2 known fixture-order FAILs.
- **Web, 5 real accounts in separate browsers against a mock of 0006: 80/80.**
  - Create a group (and the minimum); B and C see it live; realtime group messages with names.
  - The outsider sees nothing and direct reads/sends are refused.
  - The long-press menu. Reactions live. Same Brain appears exactly once on all 3 phones; remove and re-add doesn't repeat it.
  - Reply with a quote. Unsend, including live for others. Moving a message is refused; a deleted message refuses reactions.
  - Pings: private, hidden until the 3rd compatible one, then the reveal on all three; Make a plan.
  - Loop from a message (date, place), live for all; another member resolves it; reopen; Create World (Private, owner only, linked, People tab).
  - The Chemistry card lines.
  - Group info: rename (live for others; a member can't), add D (live), make admin, admin can't remove the owner, remove D (D's app drops it live, D can't read), C leaves, the owner leaves → the admin becomes owner.
  - 1:1: Same Brain, and a Ping match (Call? ↔ Need advice).
  - Demo: the seeded group, a Ping reveal, and nothing reaches the REAL backend.
  - No page errors.
- **Node: 38/38** (Ping map, reveal copy, reaction counts, Chemistry determinism and ageing, the store on the Demo backend, isolation on stop) and the existing **56/56**.
- **Regression:**
  - web: 6D 72/72, 6C 69/69, 1:1 chat 38/38, avatar hotfix 15/15, delete-world 29/29, REAL smoke 33/33, REAL → Demo → REAL → logout cycles ×3 completed
  - Demo route sweep (now with the group screens): 0 errors
  - The only console noise is React Native Web's known "nested <button>" warning in Buzz/Drift, which the other suites already filter. It isn't in the new screens.
  - The web mock now carries several Realtime channels per connection, like supabase-js does.
- **Checks:** tsc 0 errors, ESLint clean.

## Still to test on real phones (3-phone script)

Phones: **A** = your developer account, **B** and **C** = two friends. A is connected with B and C.

1. Run 0006. `npx expo install expo-clipboard`. Restart all three with `npx expo start -c`.
2. **A:** Messages → 👥 → pick B and C → Next → "Niagara test" → add a photo → Create group. A lands in the group; the header shows the photo, the name and **3 members**.
3. **B and C:** without refreshing, Messages shows "Niagara test". (If B isn't connected with C, that doesn't matter: A added them.)
4. **A** sends a message, **B** sends a photo, **C** replies. Each message appears on the other two phones within a second or two, with the sender's name. Unread counts show in Messages.
5. **Reactions:** all three long-press A's message → 😂 within about a minute. All three show **😂 × 3 ⚡ Same Brain** and feel one haptic; it doesn't replay when you reopen the chat. B taps the 😂 chip to remove theirs: the count drops, the Same Brain label stays.
6. **Long-press menu:** Reply (the quote shows for everyone), Copy (paste it somewhere), Delete on your own message (gone for everyone).
7. **Ping:** A taps ✨ → Food? → Send privately. B and C see **nothing**. B sends **Free tonight** → still nothing. C sends **Hang out** → all three see "Something could happen tonight. 3 people are interested." Tap **Make a plan**.
8. **Open Loop:** B long-presses a message → Turn into Open Loop → set Tomorrow and a place → Create. A and C see "Open Loops · 1". C resolves it; A sees it under Resolved; A reopens it.
9. **Create World from the loop:** A → the loop → Create World. The composer is prefilled and set to Private → Create → the World's People tab. B and C were **not** added. The loop shows the World's name.
10. **Chemistry:** tap the Chemistry strip. It lists active members, Same Brain, the open loop, "3 up for tonight" and any World you share.
11. **Group info (A):** rename it (B and C see the new name), change the photo, make B admin, add a 4th person if you have one, then remove them (their phone drops the group).
12. **Permissions:** on B (admin), open Group info. B can rename and add, but gets no Delete group and can't remove A. On C (member), there are no edit controls, only Leave.
13. **C leaves.** Their Messages no longer shows the group; A and B see **2 members**.
14. **1:1:** A ↔ B: send, react (both 👍 within 30 s → Same Brain), Ping Call? and Need advice → "Looks like you two want to talk."
15. **Account deletion with a group:** create a throwaway account, add it to a group with A and B (A connects with it first), send a message from it, then delete the throwaway (Settings → Delete account). A and B still have the group; the throwaway's messages are gone; nothing crashes.
16. **Demo:** Settings → Developer → Enter Demo Account → You → Messages → "Niagara crew". Ping Hang out → reveal. Leave Demo: your real groups are back, with no Demo people.
17. **Force-close and reopen** Chimp on all three: groups, reactions, the Same Brain marker, loops and the match are all still there. Nothing replays.

**Don't call it release-ready until these 17 steps pass on real phones.**

## Known limitations

- **Group photo reused from a post:** if someone makes a group photo out of one of their own Buzz photos (only possible by calling the API directly; the app always uploads a fresh copy) and later deletes that Buzz, the group photo file goes with it.
- **Photos of a deleted group:** chat photos stay in their senders' `chat/{uid}/` Storage folders (unreachable: the message rows are gone) until those accounts are deleted.
- **Shared Worlds in Chemistry:** uses the member lists the app already loaded (for big Worlds, a preview), so "N of you are in it" can undercount.
- **Group size:** up to 50. Message history loads the latest 60, as in 1:1.
- **Pings:** there's no "who's waiting" hint, on purpose. A Ping you replace is gone. Matches don't notify when the app is closed (no push, by design for this patch).
- **Demo:** the other people in the Demo group don't reply live.
- **Not in this patch (by design):** voice/video, E2E encryption, AI summaries or AI Ping matching, push notifications, disappearing messages, moderation tools, Phase 7.

---

# Chimp build notes — prototype v0.6D — Identity, Ownership & Control

25 Sep 2026 · Code in `C:\Users\AI Admin\Documents\Chimp` · Expo SDK 57, Expo Router, TypeScript, Zustand, Supabase (Auth, Postgres, Storage, Realtime, **Edge Functions**). Still Expo Go: no new packages. The v0.6C notes follow below.

6D is the last Phase 6 patch before TestFlight. Phase 7 hasn't started. 6C made Chimp usable; 6D makes it **ownable**: your account, your posts and your Worlds are yours to change and delete, and the server enforces it.

| Area | What changed |
|---|---|
| **Sign-in** | Email + 6-digit code. One button, **Continue with Email**: new or returning, same path. Phone/SMS is retired. |
| **OTP screen** | Rebuilt around the keyboard: everything stays above it, paste and iOS code autofill work. |
| **Your account** | **Settings → Delete account**, done on the server. The email and @username are free again afterwards. |
| **Developer access** | Tied to the verified email `aayushmallik.contact@gmail.com`, decided on the server; survives delete + re-create. |
| **Worlds** | The "row-level security" error on **Create World** is fixed. Owner is set by the server. **Created by**, Private / Connections / Public, owner · admin · member, **Follow ≠ Join**, join requests. |
| **Your posts** | ••• → **Edit** (1 hour) and **Delete** (any time). "Edited" label. Deletes are everywhere at once. Replies too. |
| **Following** | Never shows your own posts. You can't follow yourself. |
| **Delete a World** (6D.2) | The owner can delete their World (••• → Delete World). Server-checked, full clean-up incl. Storage. |

## Final patch 6D.2 — Delete a World (28 Sep 2026)

The last ownership control before TestFlight: a World's **owner** can delete it.

### What you must do once (for this patch)

1. **SQL:** run `supabase/migrations/0005_delete_world.sql` in the SQL Editor, after 0004. It's safe to run again. If you ever re-run 0001 or 0004, run 0005 again afterwards: 0001 would bring back the direct-delete policy, and 0004 the older account-deletion function.
2. **New Edge Function:** Edge Functions → Deploy a new function → Via Editor → name it `delete-world` → paste `supabase/functions/delete-world/index.ts` → Deploy. Keep **Verify JWT** on. There's no secret to add.
3. **Re-deploy `delete-account`** with the updated `supabase/functions/delete-account/index.ts`: open the function → paste the new code → Deploy. It now also removes files from Worlds deleted with an account.
4. Restart with `npx expo start -c`.

Until `delete-world` is deployed, **Delete World** says "Deleting Worlds isn't set up on the server yet (the delete-world function). Nothing was deleted."

### How it works

- **UI:**
  - On a World **you own**, the ••• on the hero opens **Delete World** (and Settings).
  - Admins, members, followers and everyone else keep the plain ••• → Settings; they never see Delete.
  - A confirmation says "Delete this World?" / "This will permanently remove the World and its World-specific content.", plus what happens to posts in *this* World. Then **Delete World** or **Keep it**.
  - After deleting, you land on Boards.
- **Server authorization:**
  - The app calls the `delete-world` Edge Function with only its session token and the World id.
  - The function calls `public.delete_world(board_id)` **as you** (your own token). The database refuses anyone whose `auth.uid()` isn't the World's `owner_id` ("Only the World's owner can delete it."). Chimp's catalog Worlds can't be deleted by anyone.
  - The direct-delete policy from 6A is **dropped**, so no one can `DELETE` a World row from the app, not even the owner. Only the checked function deletes.
  - The service key is used only after the database has deleted the World, to remove Storage files.
- **What goes with the World:**
  - Deleted: the World row, memberships (owner, admins, members), followers, join requests and saves (cascade).
  - Its **Drift** (a Drift item must belong to a World) and its **World Stories**, with the replies and likes on them.
  - The cover, and any media row nothing else uses any more.
- **Buzz posts in the World** (Buzz can exist without a World, "Just Buzz"):
  - **Public World:** the posts **stay**, as their authors' Just Buzz. The audience doesn't change (it was everyone), and their replies and likes are kept.
  - **Connections / Private World:** the posts are **deleted**. As Just Buzz they'd suddenly be visible to everyone, which would leak private posts.
  - The confirmation tells you which applies.
- **Nothing unrelated is touched:** Just Buzz, other Worlds and their posts, profiles, avatars, chats.
- **Storage:**
  - `delete_world()` returns the files of every media row it removed, and also queues them in a private `storage_cleanup` table (RLS, no policies: invisible to the API), so a file is never forgotten.
  - The function removes them with the service key: the cover, and photos and videos **other members** posted in the World's Drift and Stories. The app couldn't do that, because Storage only lets people delete their own files.
  - It then empties the World's `boards/{id}/` folder (older covers too) and clears the queue.
- **Everywhere at once:**
  - The World leaves Boards, You / owned Worlds, the Happening graph, World pickers, Drift and Stories immediately. Posts that stay lose their World chip.
  - Your phone forgets its joined / saved / followed / requested flags for it.
  - A reload keeps it gone.
- **Other phones:**
  - A phone that still has the World in its cache checks when it opens it. If the World no longer exists, it shows **"World not found"** and drops it from its lists, with no crash.
  - Joining, following or posting into a deleted World is refused by the server.
- **Account deletion is unchanged in behaviour.**
  - Hand-on still works: a World with other members goes to the longest-standing member, admins first.
  - Worlds deleted with an account now use the same teardown. So other members' public-World Buzz survives there too, and their files are removed; `delete-account` got those three lines.

### Files

- **New:**
  - `supabase/migrations/0005_delete_world.sql`
  - `supabase/functions/delete-world/index.ts`
  - `src/components/boards/WorldOwnerMenu.tsx`
- **Changed:**
  - `supabase/functions/delete-account/index.ts`: also removes deleted Worlds' content files.
  - `src/components/boards/BoardHero.tsx`: the owner's ••• opens the menu.
  - `src/app/board/[id].tsx`: the stale-World check; "World not found".
  - `src/services/backend/content.ts`: `deleteWorld`, `worldStillExists`.
  - `src/services/backend/realData.ts`: `removeBoard`.
  - `src/services/backend/ownContent.ts`: `deleteMyWorld`.
  - `BUILD_NOTES.md`, `README.md`.

### Tested locally (not on your Supabase project or iPhone)

- **Postgres, 0001–0005** (0004 and 0005 re-run to check idempotence): **34/34**.
  - A: the owner deletes. B–E: the admin, member, follower, a stranger, and anyone on a catalog World are refused.
  - K: a direct DELETE is refused for everyone, the owner included; the internal teardown can't be called from the API; refused attempts change nothing.
  - F: memberships, follows, requests and saves are gone.
  - G: the cover, Drift and Story media rows are removed, their files returned (another member's Drift photo included) and queued.
  - H: public-World Buzz is kept with its reply and like; unrelated Just Buzz, other Worlds, avatars and profiles are intact.
  - Private-World Buzz is deleted, not made public; a repeat delete is harmless.
  - I: a former member can't see, join or post into it.
  - J: account deletion hand-on still works and deletes the rest through the same teardown.
  - `storage_cleanup` can't be read or written through the API.
- **Earlier SQL suites on 0005:** 0004 62/62, avatar 9/9, chat 35/35, 0003 19/19. 6A RLS: the same 2 known fixture-order FAILs as its baseline.
- **Edge Function** in real Deno against a mock API (`deno check` clean for both functions):
  - No token / forged token → 401; bad id → 400.
  - The admin → 403 **from the database check**, with no Storage calls.
  - The owner → the RPC is called with the **owner's token**. The service key is used only for the file removals (cover, another member's Drift photo, the Story), the `boards/{id}/` sweep (an old cover) and the queue.
  - A repeat call is harmless.
- **Web, end to end:** **29/29.**
  - The admin, member, follower and stranger see no Delete; a direct call as admin → 403; a direct row delete → refused.
  - The owner's confirmation copy; Keep it cancels; Delete → Boards.
  - Server rows and files gone.
  - Gone from Boards, You, Happening, the World picker and Drift; Maya's post stays as Just Buzz without the chip.
  - Old link → World not found; still gone after a reload.
  - The second phone's stale copy → World not found, and gone from its Boards.
  - Private World: the confirmation says posts are deleted, and they are.
  - Unrelated content intact.
- **Regression:**
  - web: 6D 72/72, 6C 69/69, chat 38/38, avatar hotfix 15/15, REAL smoke 33/33
  - Demo sweep: 0 errors
  - Node: 56/56
- **Checks:** tsc 0 errors, ESLint clean.

### Test on real Supabase + iPhone

1. Run 0005; deploy `delete-world`; re-deploy `delete-account`.
2. **Create a World** (Public), add a cover, and post a Buzz and a Drift photo in it.
3. **Second account** (a friend's phone): Follow the World → Ask to join. On yours: World → People → Approve. The friend posts a Buzz and a Drift photo in it.
4. **Check who sees Delete:** make the friend an admin (People → Make admin). On the friend's phone, the World's ••• shows no Delete World.
5. **Delete as the owner:** ••• → Delete World → read the confirmation → Delete World. You land on Boards.
6. **Gone everywhere at once:** Boards, You, Happening, the World picker when writing a Buzz. Your Buzz and the friend's Buzz are still in Buzz, without the World chip. The Drift photos are gone.
7. **Force-close and reopen Chimp:** it's still gone.
8. **Friend's phone:** open the World from their list or an old link → "World not found". Pull to refresh Buzz: their post is still there as Just Buzz.
9. **Unrelated data:** your chat with the friend, both profiles and avatars, other Worlds and their posts are unchanged.
10. **In Supabase:**
    - Table Editor: no `boards` row, no `board_memberships` / `board_follows` / `board_join_requests` rows for it, and `storage_cleanup` is empty.
    - Storage → `media`: no `boards/{id}/` folder, and the friend's Drift photo is gone from `drift/{friend id}/`.
11. **Private World:** create one, post in it, delete it. The confirmation says its posts are deleted, and they don't appear in Buzz.

## Hotfix 6D.1 — onboarding photo: "violates foreign key constraint media_owner_id_fkey" (28 Sep 2026)

**What you saw (real Supabase, iPhone):** a brand-new verified account, "Make it yours", photo picked, fields filled, **Continue** →
`Couldn't save media: insert or update on table "media" violates foreign key constraint "media_owner_id_fkey"`.

**Root cause (confirmed on Postgres with the real migrations):**

1. **Wrong write order in onboarding.**
   - `media.owner_id` references `profiles(id)` (0001), and nothing creates a profile row at sign-up: the first `profiles` row is written by onboarding itself.
   - But `profile-setup.tsx` uploaded the photo and inserted its `media` row **before** its first `saveProfile`. For a brand-new account there's no profile yet, so the FK refuses the row.
   - This order dates from 6A. 6D didn't change it, but 6D is the first time a new account went through onboarding **with a photo** on the real project (the old phone account's profile already existed). The web mock didn't enforce foreign keys, so the tests missed it.
2. **A second bug behind it: re-uploading an avatar.**
   - Avatars always went to the same file, `avatars/{uid}/avatar.jpg`, and the media row was saved with an upsert on `storage_path`.
   - The second time, that upsert becomes an UPDATE, and `media` has no UPDATE policy. So changing an existing photo in Edit profile (or retrying onboarding after the row was saved) failed with `new row violates row-level security policy (USING expression) for table "media"`.

**The fix. No schema change: the FK and RLS are untouched, no UPDATE policy added, no service key:**

- **Onboarding order:**
  1. The profile row is saved first (an upsert on your own id; repeating it is harmless).
  2. Then the photo is uploaded and its media row inserted.
  3. Then the profile points at it (`avatar_media_id`, `avatar_url`).
  4. Only then is any previous photo removed.
  5. Onboarding continues.
- **Every image upload gets a new file name** (`uploadImage`), so the media row is always a plain INSERT, never an update. This also fixes Edit profile photo changes.
- **Retry-safe:**
  - If the file uploads but its media row fails, the file is deleted again (no orphan in Storage).
  - If the photo uploaded but linking it to the profile failed, **Continue** reuses that upload: no second copy, no duplicate row.
  - If the photo step fails, the screen says your profile is saved and offers **Continue without the photo** (add one later in Edit profile).
- **Replacing a photo** removes the old media row and file (your own only, by RLS), after the profile points at the new one. Old 6A-style `avatar.jpg` avatars are cleaned up the same way the first time you change them.

**Files changed:**

- `src/services/backend/media.ts`:
  - `uploadImage`: fresh name, plain insert, cleanup on failure.
  - New `setProfilePhoto` and `discardMediaById`.
- `src/app/(auth)/profile-setup.tsx`: the order, retry reuse, and Continue without the photo.
- `src/app/edit-profile.tsx`: text first, then the photo; the old photo is removed.

**Tested locally:**

- **Postgres** (0001–0004, Supabase-like roles): 9/9.
  - It reproduces both errors exactly with the old order.
  - A: new user + photo. B: no photo. C: retry after failure. D: changing the photo twice, one row left.
  - The FK is still there, there's still no UPDATE policy, and nobody can create or delete someone else's media.
- **Web, end to end:** 15/15, with a mock that now enforces the FK and the missing UPDATE policy like the real database.
  - A: profile → upload → media → link; next step.
  - B: no photo.
  - C: media row fails → file removed and the message shown; linking fails → the next Continue reuses the upload (0 new uploads); Continue without the photo works.
  - D: Edit profile photo changed twice from the real button; the old rows and the 6A `avatar.jpg` removed.
- **Checks and regressions:** tsc 0 errors, ESLint clean. 6D suite 72/72, 6C suite 69/69 (photo posts, covers), chat 38/38, REAL smoke 33/33. SQL suites: 0004 62/62, chat 35/35, 0003 19/19.

**Must test on the real project / iPhone:**

- A new email → onboarding with a photo from the Photo Library and from the Camera → Continue → phrase screen. Check that the photo shows on You.
- Edit profile → change the photo twice. In Supabase → Table Editor → `media`, there's one avatar row for you, and Storage → `media/avatars/{your id}/` holds one file.

## What you must do once

Do these in order. Nothing here needs a secret in the app.

1. **Run the SQL.** Supabase → SQL Editor → paste all of `supabase/migrations/0004_phase6d.sql` → **Run**. Run it after 0001–0003 (they're unchanged). Running it twice is harmless.
2. **Deploy the delete-account function.** Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
   - Name it exactly `delete-account`.
   - Replace the sample code with all of `supabase/functions/delete-account/index.ts`, then **Deploy**.
   - Leave **Verify JWT** on (the default).
   - You don't add any secret: Supabase gives every Edge Function its own service key. It never leaves Supabase.
3. **Turn on email sign-in.** Authentication → **Sign In / Providers** → **Email**:
   - Enable the Email provider.
   - Set **Email OTP expiration** (for example 600 s = 10 minutes; the default is 1 hour). Supabase's own limit is one code per email every 60 s.
   - If there's an OTP length setting, keep it at 6.
4. **Make the emails send a code, not a link.** Authentication → **Emails** → Templates. In **Magic Link** (returning people) *and* **Confirm signup** (first-time people), put the code in the body, for example:

   ```html
   <h2>Your Chimp code</h2>
   <p>Enter this code in Chimp: <strong>{{ .Token }}</strong></p>
   <p>It works for a limited time. If you didn't ask for it, ignore this email.</p>
   ```

   Keep the subject short ("Your Chimp code"). Remove `{{ .ConfirmationURL }}` if you don't want a link in the email.
5. **Custom SMTP before friends test.** Supabase's built-in sender only delivers to your project's team members, about 2 emails an hour. That's enough for you alone (your address is on the team), but friends will get "Email address not authorized". Set up a provider (Resend, Postmark, SendGrid, Amazon SES…) under Authentication → **SMTP Settings**, then raise the email rate limit under Authentication → Rate Limits.
6. **Phone sign-in is retired.** You can switch the Phone provider off and delete the Twilio credentials and the 555 test numbers from the dashboard. In `.env.local`, delete the `EXPO_PUBLIC_ENABLE_TEST_AUTH` line (nothing reads it now).
7. **Delete two files from your copy** (the new code doesn't use them; delivery can add and change files but not remove them):
   - `src/config/testAuth.ts` (the old phone test-number bypass)
   - Optional: `npm uninstall libphonenumber-js` (only the removed phone screen used it).
8. **Restart:** `npx expo start -c`.

### The old +1 555-555-0101 WollyMc account

It's disposable test data, so nothing migrates. Either way works:

- **In the app** (if that phone session is still signed in): after steps 1–2, open **Settings → Delete account**, type DELETE. You land on Welcome.
- **From the dashboard:** SQL Editor → `select public.prepare_account_deletion('<its user id>');` (hands nothing on, deletes its Worlds and chats), then Authentication → Users → that user → **Delete user**. Its files stay in Storage → `media` until you delete the folders with its id.

Then tap **Continue with Email**, use `aayushmallik.contact@gmail.com`, enter the code, and recreate WollyMc from scratch (the `wollymc` username is free once the old account is gone). Developer tools appear by themselves.

## 1. One sign-in path: Continue with Email

- **Welcome** has one primary action, **Continue with Email**. There's no Sign Up / Sign In choice.
- **Email screen:** type your email → **Continue**. It's trimmed and lower-cased (`normalizeEmail`) before anything is sent.
- The app calls `signInWithOtp({ email, options: { shouldCreateUser: true } })`. A new email gets a new Auth user; a known one gets its account back. The Auth user is only usable after the code is verified.
- **Verify screen:** `verifyOtp({ email, token, type: 'email' })` → a real session.
- **Where you go next depends only on the profile:** a finished profile → Buzz; missing or unfinished → onboarding (profile → phrase → interests → Open To).
- **No shortcuts:** nobody skips the code, the developer email included. Developer access is looked up (`my_access()`) only after there's a verified session.
- **Sessions persist:** Supabase keeps the session in AsyncStorage and refreshes it, so you verify once per phone. If Supabase itself ends the session (refresh token revoked, or the account deleted on another phone), the app returns to Welcome cleanly instead of showing a broken world.
- Old `/phone` links redirect to `/email`.

## 2. The OTP screen and the iPhone keyboard (release-blocking fix)

**What was wrong.** The old verify screen stacked a 200 pt illustration, a 44 pt headline and the boxes, with Verify pinned in a footer inside a `KeyboardAvoidingView`. With the number pad up, the boxes and footer competed for the space left, and on smaller phones things slid under the keyboard or jumped.

**How it works now.**

- **Measured, not guessed:** a new hook, `useKeyboardHeight()` (`src/hooks/useKeyboard.ts`), uses React Native's own keyboard events, so it runs in Expo Go:
  - iOS: `keyboardWillShow / WillChangeFrame / WillHide`, with the height taken from the keyboard's final frame. The layout change is animated with the keyboard's own curve, so there's no jump.
  - Android: `keyboardDidShow / DidHide`, minus anything the window already resized for.
  - If the keyboard is already up when the screen opens (coming from the email field), it starts from `Keyboard.metrics()`.
- **The auth screens pad their bottom edge by that height** (plus safe areas), so the scroll area is exactly the space above the keyboard.
- **The verify screen is top-aligned and compact:** title (smaller while typing) → "We sent a 6-digit code to wo•••@gmail.com" → the six boxes → any error → **Verify** (inline, right under the boxes) → **Resend in 58s / Resend code** and **Change email** → a "check Spam" hint. The Chimp illustration only fills leftover space and never pushes anything.
- **Boxes size from the measured width** (36–56 pt, gaps 7–10 pt), so six always fit on any iPhone and with Larger Text. The digits don't scale past the box.
- **One real input covers all six boxes:**
  - A long-press anywhere offers **Paste**.
  - `textContentType="oneTimeCode"` / `autoComplete="one-time-code"` lets iOS offer the code from Mail above the keyboard.
  - Pasting "123 456" or "Your code is 123456" keeps only the digits.
  - The sixth digit verifies automatically; a wrong code shows a message and clears the boxes for a retry.
- **Natural dismiss:** drag the screen down (iOS interactive dismiss) or tap outside.

## 3. Delete account (server-side)

**Settings → Delete account** opens a screen that says what's deleted, lists the Worlds you own (and how many other members each has), offers **Hand them on instead**, and only enables **Delete my account permanently** after you type DELETE.

**What happens:**

1. The app calls the `delete-account` Edge Function with only its session token (`supabase.functions.invoke`). No user id is ever sent: the function works out who you are from the token (`auth.getUser`), so nobody can delete someone else.
2. The function runs `prepare_account_deletion()` (service role only; the app can't call it): your Worlds are handed on or deleted, your 1:1 chats end, other people's replies and likes on your content are removed.
3. It removes your Storage files: `avatars/`, `posts/`, `drift/`, `stories/`, `chat/` under your id, and the covers of Worlds that were deleted.
4. It hard-deletes the Auth user (`auth.admin.deleteUser(id, false)`). Every table cascades from it.
5. The app clears the session, this account's cached world and its on-phone store bucket, then shows Welcome.

If a step fails, you get the message and can simply retry: each step is safe to repeat.

### Data policy: what happens to each kind of data

| Data | On account deletion |
|---|---|
| Auth user (email) | Deleted (hard). The email can sign up again and gets a **new** user id. |
| Profile, @username, photo, bio, Open To | Deleted. The username is free for anyone. |
| Buzz posts, Drift, Stories | Deleted, with their media rows. |
| Your comments / replies anywhere | Deleted. |
| Replies and likes others left on your content | Deleted (no orphan rows). |
| Your likes, saves, dislikes, reposts, poll votes | Deleted. |
| Follows (both directions), connections, Crushes, blocks | Deleted. Other people's counts drop. |
| 1:1 chats | The whole conversation is deleted, for both people (nothing half-empty is left). |
| Worlds you own | **Deleted** (default), with their posts, memberships, follows and requests. Or, with **Hand them on**: each World that has other members goes to its longest-standing member (admins first). |
| Handed-on Worlds | Stay, with a new owner. "Created by" keeps your old display name as text; the link to your profile is cleared. |
| Worlds you're a member / follower of | Your membership, follow and requests are removed. |
| Storage files | Your folders are emptied; deleted Worlds' covers removed. A handed-on World keeps its cover. |
| Developer access | Not stored on the account (it's by email), so a re-created account gets it back. |

Nothing is kept as a tombstone: other people see no "deleted user" cards, because the rows are gone.

## 4. Same email, same username, developer access

- **Email reuse:** the Auth user is really deleted, so signing up again with the same email creates a new Auth user with a new UUID, a new empty profile and onboarding.
- **Username reuse:** `profiles.username` goes with the profile, so the old handle shows **Available ✓** in onboarding unless someone else took it meanwhile. A username held by a current account stays taken.
- **Developer access (`aayushmallik.contact@gmail.com`):**
  - The server table `developer_emails` holds the address, trimmed and lower-cased. It has RLS with no policies, so the API can't read or change it.
  - `is_developer(uid)` joins it to `auth.users` on `lower(btrim(email))`, and only counts a **confirmed** email (`email_confirmed_at is not null`).
  - `my_access()` returns `{ developer }` for the caller. The app uses it only to show the DEVELOPER section, Demo entry and Graph Debug. Nothing the app shows or hides decides access.
  - Because it's by email, not by UUID, a deleted and re-created account gets it back automatically.
- **Demo:** only reachable from Settings → Developer (or on a build with no backend configured). Entering Demo no longer signs you out; **Leave the Demo account** returns you to your own account.

## 5. The Board creation bug ("new row violates row-level security policy for table boards")

**Root cause.** `createWorld` runs `insert(...).select('*').single()`: Postgres `INSERT … RETURNING`. When a statement returns the new row, Postgres also checks it against the table's SELECT policy. The 6A read policy was `can_see_board(id)`, a `STABLE SECURITY DEFINER` function that looks the World up **by id in a fresh query**. That query runs with the statement's snapshot, which can't see the row being inserted, so it returned false, and Postgres rejected the insert with exactly that message. It failed for every REAL World since 6A, public or private; the test mock didn't emulate RLS, so it only showed on the real project. Reproduced on local Postgres: with RETURNING it fails, without RETURNING it succeeds.

**The fix (0004), without loosening anything:**

- `"boards read"` now decides from the row's own columns: `visibility = 'public' or owner_id = auth.uid() or is_board_member(id) or (visibility = 'connections' and are_connected(auth.uid(), owner_id))`. The owner check sees the new row, so `INSERT … RETURNING` works.
- The INSERT policy is unchanged: `owner_id = auth.uid()` and only user types. No `with check (true)`, RLS stays on.
- **Ownership is server-derived:** a `BEFORE INSERT` trigger sets `owner_id` and `creator_id` to `auth.uid()` and records `creator_name` from your profile, whatever the app sent. An `AFTER INSERT` trigger adds your **owner** membership (the app no longer inserts it).
- A `BEFORE UPDATE` trigger stops anyone changing `owner_id` directly (only the account-deletion hand-on can) and keeps `created_at` / `creator_name` fixed.

## 6. Worlds: provenance, access, roles, Follow vs Join

- **Created by:** every person's World shows "Created by *name*" (or "Created by you") and the month. Chimp's catalog Worlds say "By Chimp".
- **Access levels** (Create World → *Who can see it*): **Private** (only you and people you add) · **Connections** (default: your connections can find it and ask to join) · **Public** (anyone can find and follow it; joining still needs approval). The hero shows a small Private / Connections badge.
- **Roles:** owner · admin · member. A **follower** is not a member.
- **Follow ≠ Join:**
  - **Follow:** you get its activity; no member rights. Real follower counts.
  - **Join:**
    - Chimp's open catalog Worlds: joined at once.
    - A person's World: **Ask to join** → **Requested** (tap again to cancel) → the owner or an admin approves.
    - The owner and admins can also add their connections directly.
  - Niagara (or any World you make) is therefore approval-based; make it Private if only invited people should even see it.
- **Hero numbers are real:** "N members • M followers • K posts".
- **People tab for the owner/admins:** Requests (Approve / Decline), Members with roles (the owner can Make admin / Unmake admin / Remove; admins can remove members), and **Add your connections**. Every action is re-checked by a server function.
- **Subtle provenance on posts:** a quiet "Creator" note next to the World chip when the post is by the person who made that World.
- The owner can't "leave" their own World (the button reads **Your World** and opens People).

## 7. Your posts: edit for 1 hour, delete any time

- **••• on your own posts** (REAL): Buzz cards, the Buzz detail, media and video cards.
- **Edit post:**
  - The menu says how long is left ("You can edit for 38 more minutes").
  - You can change the words and the World.
  - Photos and videos can't be changed ("delete and post again").
  - Polls can't be edited.
- **The server decides:**
  - `edit_buzz()` only lets the author edit, and only while `now() - created_at` is under 1 hour, by the **server's** clock. After that it answers "Posts can be edited for 1 hour after posting. You can still delete it."
  - Direct UPDATE/DELETE on Buzz is no longer allowed at all.
- **"Edited" label:** `created_at` never changes; `edited_at` is set. Everywhere the post appears it reads like "wollymc · 18m · Edited": cards, detail, the World, Drift.
- **Delete post** (any time, after "Delete this post?"):
  - `delete_buzz()` removes the post, its replies, likes, saves and reposts, and its media rows (if no other post uses them). It returns the files, which the app deletes from Storage.
  - It disappears at once from For You, Following, Trending, Drift, the World, your profile and saves. A stale phone can't like it afterwards (new likes need a post you can see).
- **Replies and comments** (Buzz thread and Drift comments): ••• → **Edit** (1 hour; the composer turns into the editor) and **Delete**, also enforced by server functions, and also labelled "Edited".

## 8. Following never shows your own posts

The Following tab is people you follow or are connected with, and Worlds you joined or own, newest first, **never your own posts** (they're on You and in For You). The follow button never appears for yourself; the app and the database (`check (follower_id <> followee_id)`) both refuse a self-follow.

## Security, in one place

- **No privileged key in the app.** The service key exists only inside Supabase for the Edge Function. It isn't in `.env.local`, Expo constants, the bundle or any client code. The app has the publishable key only.
- **RLS unchanged or tighter:**
  - Boards read (fixed, not loosened); memberships, follows and requests own-only.
  - Buzz UPDATE/DELETE policies removed in favour of checked functions.
  - New reactions must target something you can see.
- **Every new mutation checks `auth.uid()` on the server:**
  - editing and deleting posts and comments
  - joining, approving, adding and removing members, changing roles, leaving
  - account deletion (the caller only, via the token)
- **Security-definer functions** set `search_path` and are granted to `authenticated` only (revoked from `public` and `anon`). `prepare_account_deletion` is service-role only; `is_developer` isn't callable from the API.

## Verification

### TESTED LOCALLY (this workspace; not on your iPhone, not on your Supabase project)

- **TypeScript:** `npx tsc --noEmit` passes with 0 errors.
- **ESLint:** `npx expo lint` passes with 0 errors and 0 warnings, and no new suppressions.
- **Postgres 16** (Supabase-like stub: roles, `auth.uid()`, `auth.users` with email, storage schema), migrations 0001 → 0004, with 0004 run twice:
  - **0004 suite: 62/62.** It covers:
    - World create with RETURNING
    - spoofed owner → still yours
    - owner-change blocked
    - visibility (connections / private)
    - Follow ≠ Join
    - request / approve / add / remove / roles
    - edit within the hour; refused after 61 minutes (server time); refused for others
    - delete: replies / likes / media, returned Storage paths, idempotent
    - orphan like refused
    - comments edit / delete
    - developer by confirmed email only (an unconfirmed look-alike doesn't count)
    - deletion: hand-on, provenance, cascade, email reuse → new id, username reuse and developer access back
  - **Earlier suites on the 0004 database:**
    - 0003 (6C): 19/19 (+1 new check)
    - chat: 35/35
    - 6A RLS: 35 pass. The same 2 known fixture-order FAILs as the 6A baseline (a Crush sent before the second profile exists), rechecked and passing in the follow-up file.
    - The 6A/chat/6C fixtures that joined a person's World directly now go through request + approve, by design.
- **Edge Function** (real Deno 2.9 runtime, against a mocked Supabase HTTP API):
  - GET → 405; no token → 401; forged token → 401; missing confirmation → 400.
  - A valid token with a *different* `userId` in the body deletes **only the caller**.
  - Correct order: prepare → storage list/remove per folder (+ deleted World covers) → `DELETE /auth/v1/admin/users/{caller}` with `should_soft_delete: false`.
- **Web (Playwright, dev build, multi-user mocked Supabase)**
  - **6D suite: 72/72.** It covers:
    - auth + keyboard at iPhone 12 / 15 Pro Max / 17 sizes: one button, normalized email, masked address, simulated keyboard with the top safe-area inset, typed digits, wrong code, paste of "Your Chimp code is 123 456", new email → onboarding
    - existing account → Buzz; developer check only after verify; session survives reopening
    - own-post edit / Edited / 1-hour lock / delete everywhere; replies edit / delete; Following excludes self
    - Create World (Connections default) → server-derived owner; Follow / Ask to join / approve; real counts
    - delete account → Welcome, nothing left on the phone → same email = new id → username free → developer back; non-developer sees no developer tools
  - **Regression on the 6D build:**
    - 6C suite at 3 sizes: 69/69. B6 now expects Following without your own posts; E1 now reads "2 members • 0 followers • 4 posts".
    - chat: 38/38.
    - REAL smoke: 33/33 (the World now gets its owner membership from the server).
    - REAL → Demo → REAL → logout → login cycles: complete. Leaving Demo now returns to your account.
    - Demo sweep of every route: 0 errors.
    - Node graph/ranking: 56/56.
  - The only console errors are the known web-only nested-button warnings, also present in 6C.

### MUST TEST ON REAL SUPABASE (not done here)

- 0004 runs cleanly on your project.
- The delete-account function deploys, and deleting really removes the Auth user (Authentication → Users), the Storage folders and the rows.
- Your email templates send a **code** (Magic Link and Confirm signup); custom SMTP delivers to a friend's address.
- Create World works on the real project (the RLS fix).
- A second account can Follow / Ask to join, and you can approve.
- Edit is refused after an hour by the real server clock.
- Re-signing up with the same email after deletion gives a new id; `wollymc` is reusable; developer tools come back.

### MUST TEST ON AN iPHONE (not done here; web can't show the real keyboard)

- The OTP screen with the real number pad on iPhone 12, 15 Pro Max and 17: everything visible, no jump, interactive dismiss.
- Code autofill from Mail (QuickType bar), and long-press → Paste.
- Larger Text (Settings → Display & Brightness → Text Size, and Accessibility → Larger Text).
- The Delete account screen with the keyboard up.
- The ••• menus and edit sheet.

## Changed files

**New:**

- `supabase/migrations/0004_phase6d.sql`
- `supabase/functions/delete-account/index.ts`
- `src/app/(auth)/email.tsx`
- `src/app/delete-account.tsx`
- `src/app/edit-buzz/[id].tsx`
- `src/hooks/useKeyboard.ts`
- `src/components/ui/OwnerMenu.tsx`
- `src/components/boards/WorldPeople.tsx`
- `src/services/backend/ownContent.ts`
- `src/utils/editWindow.ts`

**Changed:**

- Auth screens: `src/app/(auth)/phone.tsx` (now a redirect), `verify.tsx`, `welcome.tsx`, `_layout.tsx`
- Other screens: `src/app/_layout.tsx`, `src/app/settings.tsx`, `src/app/graph-debug.tsx`, `src/app/board/[id].tsx`, `src/app/buzz/[id].tsx`, `src/app/comments/[postId].tsx`, `src/app/create/world.tsx`
- Components: `src/components/auth/AuthUI.tsx`, `src/components/boards/BoardHero.tsx`, `src/components/buzz/BuzzCard.tsx`, `src/components/drift/DriftPager.tsx`, `src/components/profile/PersonRow.tsx`
- Graph: `src/graph/surfaces.ts`
- Backend services: `src/services/backend/auth.ts`, `content.ts`, `mappers.ts`, `realData.ts`, `src/services/create.ts`
- Stores and types: `src/store/useChimp.ts`, `src/store/useSession.ts`, `src/types/models.ts`
- Config and docs: `tsconfig.json` and `eslint.config.js` (both ignore `supabase/functions`, which is Deno code), `.env.example`, `README.md`, `BUILD_NOTES.md`

**Delete by hand:** `src/config/testAuth.ts`.

**Store:** no reset. The on-phone store stays at version 6; the new fields `followedBoards` and `joinRequested` start empty.

## Known limitations

- **Edit/delete is for REAL Buzz posts and replies.** Drift items and Stories can't be edited; they're removed with the account. Demo posts don't have the ••• menu.
- **Other phones catch up on their next refresh.** Another person's phone that's already showing your deleted post keeps it until it refreshes. Their likes on it are refused; opening it shows "Not found".
- **Account deletion isn't one database transaction.** If the final Auth delete fails after the Worlds step, retrying finishes it (every step is repeatable).
- **Group chats don't exist yet;** only 1:1 chats are removed.

## TestFlight release gate

Ship to TestFlight only when all of these are true on the real project and a real iPhone:

- [ ] 0004 applied; the delete-account function deployed; the email templates send a code; custom SMTP delivers to a non-team address.
- [ ] **Continue with Email** → code → Buzz for an existing account; → onboarding for a new one. The session survives an app restart.
- [ ] The OTP screen passes the keyboard checks on at least two iPhone sizes and with Larger Text. Paste and code autofill work.
- [ ] Create World works: Private, Connections and Public. A second account can Follow and Ask to join; you approve.
- [ ] Edit a post under 1 hour → "Edited"; after 1 hour it's refused. Delete removes it everywhere. Replies the same.
- [ ] Following shows no own posts.
- [ ] Delete account → Welcome. Same email → new account; `wollymc` reusable; developer tools back. A non-developer sees none.
- [ ] Regression on the phone: Buzz (For You / Following / Trending / Drift), Happening, Stories, video, covers, chat, You, After Dark, Demo entry/exit.
- [ ] No service key anywhere in the repo or `.env.local`. Only `EXPO_PUBLIC_SUPABASE_URL` and the publishable key.

Then freeze Phase 6.

## What to test on your iPhone

1. **Welcome** → **Continue with Email** → `aayushmallik.contact@gmail.com` → Continue.
2. **On the code screen, with the keyboard up:** can you see the title, all 6 boxes, Verify, Resend and Change email? Type 2 digits: are they visible? Drag down: does the keyboard go away smoothly?
3. **Wrong code** (e.g. 000000): the message is visible above the keyboard.
4. **Code from Mail:** use the suggestion above the keyboard, or copy the whole email line and long-press → Paste.
5. **New account → onboarding.** Recreate WollyMc (`wollymc`). You land in Buzz. **Settings** shows your email and DEVELOPER.
6. **Force-quit and reopen:** you're still signed in, with no new code.
7. **Worlds:**
   - Create a World (Connections), and check it shows Created by you and "1 member • 0 followers".
   - On a friend's phone (connected): Follow → Ask to join.
   - On yours: World → People → Approve.
8. **Posts:**
   - Post "Test edit" → ••• → Edit → change it → it shows "Edited" in Buzz and in the World.
   - Check Following doesn't list it.
   - ••• → Delete → it's gone everywhere.
9. **Delete account:**
   - On a throwaway email: Settings → Delete account → type DELETE → Welcome.
   - Sign up again with the same email: onboarding, same username available.

---

# Chimp build notes — prototype v0.6C — Trip Demo Candidate

25 Sep 2026 · Code in `C:\Users\AI Admin\Documents\Chimp` · Expo SDK 57, Expo Router, TypeScript, Zustand, Supabase (Auth, Postgres, Storage, Realtime). Still Expo Go: the one new package, **expo-video**, is bundled in Expo Go. The v0.6B notes follow below.

6C is the last structural pass of Phase 6, before the Niagara trip. Phase 7 hasn't started.

| Surface | What it is |
|---|---|
| **Boards** | Persistent shared Worlds, each with one real cover image. |
| **Buzz** | Posts, photos, **short videos**, polls and conversation. Sub-tabs: **For You · Following · Trending · Drift**. A World is optional. |
| **Happening** | The endless Opportunity Graph, Stories, and what's moving around you. It's no longer a feed. |
| **You** | Identity, connections, messages, your agent. |
| **After Dark** | Unchanged. |

## What you must do once

1. **Supabase → SQL Editor:** run `supabase/migrations/0003_phase6c.sql`. Run it after 0001 and 0002; running it again is safe. It adds:
   - the `video` kind for Buzz
   - `media.poster_path`
   - a 50 MB file limit on the `media` bucket, for mp4 and mov clips
   - `reaction_counts()`, which returns real like totals
2. **Install the new package:** run `npm install`. `package.json` now lists `expo-video ~57.0.4`, and `app.json` lists its config plugin, which Expo Go doesn't need.
3. **Restart:** `npx expo start -c`.
4. **If uploads of long clips fail with "larger than your Chimp storage allows":** go to Supabase → Storage → Settings and check the project's upload file size limit. The project limit wins over the bucket's.

No `.env` changes. The local store stays at version 6: nothing is reset, and there's a new `driftDislikes` field whose default is empty.

## 1. Buzz launch: what was actually slow

**Before 6C, a signed-in launch did this, in order:**

1. Restore the store (it reads the Demo bucket first).
2. `getSession`.
3. Fetch your profile. This was **a blocking network request**.
4. Switch to the "One moment…" transition screen. That screen is meant for account changes, but it also ran at launch.
5. Swap the store bucket.
6. Show Buzz, **empty**.
7. Load the whole world in **about 6 sequential network waves**:
   - 15 queries
   - then media
   - then people
   - then poll votes and replies, one chunk after another
8. Chat's Realtime connection and the inbox RPC started at the same moment, competing with Buzz.

So Buzz waited on a network request plus a fake-looking screen, and its content waited on about 7 round trips. On mobile data that's typically 1.5–3 s.

**Now:**

- **Launch never shows the transition screen.** Nothing is mounted yet, so there's nothing to switch away from. Demo launch works the same way.
- **This account's last load is cached on the phone.** It's stored as rows under `chimp-real-cache:{uid}`, only read for that same uid, and removed when that account signs out.
  - Launch: session known → cached world published → Buzz renders with content → Supabase refreshes it in the background.
  - First launch on a phone (no cache): Buzz shows placeholder cards, never a "Buzz is quiet" flash.
- **The load is 2 parallel waves instead of about 6 sequential ones.** Everything is fetched first, then everything those rows reference.
- **Deferred until after Buzz has painted:** chat Realtime and the inbox, plus the re-entry "world moves on" computation.
- **Development logs** show every launch stage. From the web run with 350 ms of simulated latency per read:

  ```
  [chimp:startup] +79ms  store hydrated
  [chimp:startup] +80ms  boot
  [chimp:startup] +84ms  session known (signed in)
  [chimp:startup] +91ms  Buzz ready (cached world)
  [chimp:startup] +97ms  chat started (deferred)
  [chimp:startup] +295ms fonts ready
  [chimp:startup] +876ms fresh world loaded
  ```

  - Cold relaunch: content was visible **0.29 s** after reload.
  - First sign-in with no cache: **1.58 s**, with placeholders meanwhile.
  - Not measured: the old build under the same latency, and the iPhone itself. Watch the `[chimp:startup]` lines in Metro to see your real numbers.

## 2. Fresh Buzz order (the "Test Buzzzzz" bug)

**Cause.** The grid packs half-width text cards two per row. A new text post was held back waiting for a partner, while the older full-width photo post was placed first. Your newest post then rendered below the photo.

**Fix.** `utils/buzzRows.ts → packRows` now pairs a half card only with the very next item. It never lets a later item go ahead of it; a half card with no partner gets its own full-width row.

**Ordering per sub-tab** (`graph/surfaces.ts → rankBuzz`):

| Tab | Order |
|---|---|
| **For You** | The graph's ranking, with its freshness boost. **Your own posts from the last 30 minutes lead, newest first** (`pinFresh`), then the ranked feed with no duplicates. This applies to For You only. |
| **Following** | People you follow or are connected with, Worlds you joined or own, and you. **Newest `created_at` first.** |
| **Trending** | **Most likes first, then newest.** Likes are the real totals from `reaction_counts()` plus yours. Nothing is pinned here, so a new 0-like post never jumps above a post with likes. |
| **Drift** | Its own visual ranking (see 4). |

**Timestamps.**

- A REAL Buzz appears only once Supabase has saved it, so its order uses the **server `created_at`** and never jumps when the row comes back.
- A retried post keeps its client-chosen id, so it can't post twice.
- Demo posts use the phone's clock.

**Like totals.**

- `likeCount` stores everyone else's likes; the UI adds yours. A like you just tapped is never counted twice.
- Totals refresh on every load and on pull to refresh. While Trending is open they also refresh when you enter it and every 60 s, using a cheap RPC.
- Your own like re-ranks instantly.

## 3. World covers

- **One canonical cover.**
  - `boards.cover_url` is the card (Boards, pickers, the graph, Drift's World chip) and `hero_url` is the hero.
  - Both are always set to the same uploaded image, so there are no separate per-surface images.
- **Uploads.**
  - Each upload goes to `boards/{worldId}/…` with a unique file name. That means no overwrite and no stale CDN copy.
  - Storage already accepts that folder only from the World's owner, and "boards update" is owner-only (0001).
- **Changing the cover:** the owner sees a camera button on the World's hero.
  - It opens the photo library (no forced crop).
  - It uploads the photo and updates the row.
  - The change reaches every surface at once, and the previous file is removed.
- **Fixed while doing this:**
  - The World screen and the Boards lists didn't re-render when a World changed. They read it outside React state (World screen) or memoised only on your graph (Boards).
  - Both now follow the dataset.
- **Crop:** images fill with `cover` (centre crop) on cards and the hero, at any width.
- **Demo:** Worlds you created on the phone can change cover too (kept locally).
- **"0 ideas":**
  - In REAL, that number was a hard-coded 0. In Demo it was a fixture.
  - It's now the **real number of posts** in the World (Buzz, World media and Board posts in what you can see): "2 members • 5 posts • Yours • Sep 2026".
  - You → Saved / Your Boards use the same counts.

## 4. Buzz → Drift

- **Drift is Buzz's fourth sub-tab.** It's a full-screen, vertical, swipe-per-item pager (`components/drift/DriftPager.tsx`).
- **Content:** photo and video Buzz, plus World photos (drift_items). They're the **same canonical items** as everywhere else, never copies.
  - Text-only posts, disliked items and After Dark never appear.
  - The order is Drift's own ranking (`buildDriftFeed`: graph scores, interleaved).
  - The order stays **frozen while you're in Drift**, so a like doesn't reshuffle it. It refreshes when content changes or you come back.
- **Per item:**
  - like, reply/comment, save, **not for me** (Buzz and now World media; an overlay with Undo), share
  - the creator (opens their profile)
  - the caption and why it's here
  - the World chip, **only when there is one**
- **Video in Drift:**
  - Only the visible clip plays.
  - It starts **muted**, and one tap unmutes for the whole Drift session.
  - Neighbours mount a player only when they're one swipe away; everything else is a poster.
  - Players are released on unmount.
- **Old `/drift` links** now open Buzz → Drift. World media still opens `/drift/[id]` (unchanged). Stories stay in Happening.

## 5. Happening is not a feed

- The two-column media feed is removed; it moved to Buzz → Drift.
- **Happening is now:** the endless graph → Friends & Connections stories → **Live across your graph** → Why this matters → Moves.
- **Live across your graph** (`graph/live.ts`) uses **real events only**:
  - "Niagara Falls Trip is active · 4 new posts" (your Worlds, last 48 h)
  - "2 people joined Niagara Falls Trip" and "Priya joined Boston Founders" (real `joined_at`, last 7 days; people you know, or anyone in your Worlds)
  - "Maya added a Story"
  - "Food is moving · 5 new posts · because you're into Food"
  - "Travel is becoming more relevant to you"
- It never shows After Dark or blocked people, and never invents counts.

## 6. The endless graph

- **One logical graph.** `graph/happening.ts → buildHappeningGraph` still holds each World once, with the collision-free lanes from 6B.
- **The cyclic canvas** (`cyclicCanvas`):
  - It adds a **copy of the last lanes before the graph and of the first lanes after it**, about three screens each.
  - It adds a **link from the last World back to the first**.
  - Lanes are never re-laid out, so spacing holds across the seam too.
- **Recentering** (`recenterX`): when a scroll settles in a copy (or gets near either end), the view jumps by **exactly one cycle** to the identical spot. The picture doesn't change, so there's no visible jump.
- **Every copy of a World is the same World.**
  - Tapping any copy selects that one logical World and opens its one branch.
  - When a branch opens, the view scrolls to the copy nearest you, never across the whole graph.
- Graphs smaller than about 1.25 screens (or fewer than 3 Worlds) stay finite.

## 7. Short video

- **Composer:** "What's buzzing?" → **Photos** or **Video** → caption → optional World → Post. There's no Meme type and no content type to pick first.
- **"Add video"** now sits on every World, next to Post here, Add photos and Add to Story (2 × 2). It opens the camera roll straight away and posts a video Buzz attached to that World.
- **Pick:**
  - From the camera roll.
  - iOS re-encodes it to 960 × 540 H.264 (`videoExportPreset`).
  - The limits are checked right away: **up to 60 s** and **up to 50 MB**, with a plain message if a clip is over either.
- **Poster:** a poster frame is made on the phone (expo-video `generateThumbnailsAsync`, then JPEG). It shows in the composer and is uploaded with the clip.
- **Upload:**
  - It streams the file straight to Storage **with progress** (expo-file-system `UploadTask` and your own session token; never a privileged key).
  - Files go to `posts/{you}/…`.
  - Then a `media` row is written with kind video, mime type, size, duration, width/height and poster.
- **Failures:**
  - **Upload fails** → "Upload didn't finish (…)". Your clip and caption stay, **nothing is posted**, and Post retries.
  - **Saving the post fails after the upload** → same message. Retry **reuses the uploaded clip** (no second upload) and the same post id, so there's no duplicate.
  - **Leaving the composer mid-upload** cancels it and removes anything already uploaded.
  - **Repeated taps** do nothing while posting.
- **Playback:**
  - **Feeds** (Buzz, Worlds) show a poster, a play badge and the length. Nothing autoplays with sound.
  - **Tap** → the one global viewer: plays with sound (tap mutes), tap to pause, progress bar, loading and "Couldn't play this video + Retry" states. Swipe down or ✕ closes it and releases the player.
  - **Drift** is as described in 4.
- **Visibility:** a video in a World follows that World's rules (`can_see_board`). It appears in the World, can appear in For You / Following / Trending and is eligible for Drift. It's still one row.

## 8. Layouts that adapt (iPhone 12 · 17 · 15 Pro Max)

Nothing is tied to one device. Everything comes from the measured width and safe-area insets, and text scaling is capped where a label must stay on one line.

- **You:**
  - "Connectio/ns" came from the **Connections / Matches tiles** further down You. They put "12 Connections" at 17 pt in a half-width tile with an icon and chevron (about 90 pt of room); the 6B fix had covered only the stats row.
  - The tile now puts the **number** and the **word** on their own lines, with Dynamic Type capped at 1.15× for these labels.
- **Other profiles:**
  - Connect · Message · ••• share one row, so each gets room.
  - ♡ Crush (only when eligible) has its own distinct row: "Crush · private" / "Crush sent · private".
  - No action was removed.
- **Buzz sub-tabs:** four equal segments with capped scaling. Checked at 390 / 402 / 430 pt: none clip.
- **Drift and the viewer:** full-screen at any height. Controls sit below the top safe area (Dynamic Island) and above the tab bar and home indicator.

## Verification (what actually ran)

- **TypeScript and ESLint:**
  - `npx tsc --noEmit` is clean.
  - `npx expo lint` is clean: **0 problems**.
  - **No new lint suppressions** (the same 5 older, documented ones).
- **Postgres 16** (0001 → 0002 → 0003, with 0003 applied twice):
  - **0003 suite: 18/18.** It covers:
    - video kind and metadata
    - unknown kinds still rejected
    - client ids can't duplicate
    - like totals are aggregate only: you can't read other people's reactions, saves and dislikes never count, and there's no count for a private World you're not in
    - anon can't call it
    - covers are owner-only (row and Storage folder)
    - videos only go into your own folder
    - bucket limits
  - **6B chat suite: 35/35.**
  - **6A suites unchanged:** 31, plus the same 2 known ordering artifacts in the test script.
- **Node (app modules):**
  - **6C: 56/56.** It covers:
    - real likes never double-counted
    - Trending, including ties, live re-rank and new posts staying below
    - Following newest first
    - For You 3 · 2 · 1 with no duplicates
    - the exact 6B row bug
    - Drift media only, videos in, not-for-me out
    - live activity
    - the cyclic graph at 390 / 402 / 430 pt: **0 collisions including across the seam**, every World once, and about 40 recenter points each, all visually identical
  - **Earlier suites:**
    - collision suite: 0 collisions
    - REAL scenario: 21/21
    - Demo scenario: unchanged
    - v5 → v6 migration: OK
- **Web** (dev build, multi-user Supabase mock with Realtime, 350 ms read latency, VP9 test clips because the test browser can't decode H.264):
  - **6C: 69/69, 0 page errors.** It covers:
    - **Startup:** no transition screen, Demo or empty flash; Buzz before the network and before chat.
    - **Posting and order:** 3 posts in order, Trending and Following.
    - **Video:** posting and playback; one player; released on close.
    - **Failures:** upload failure → no phantom → retry once; post-save failure → retry reuses the upload.
    - **World:** "Add video" in the World; cover upload → hero → Boards card → replace → old file removed → still there after a relaunch.
    - **Drift:** 11 swipes, never more than one clip playing, muted start, World chip only when attached, like/save persisted, creator → back, comments.
    - **Happening:** live activity, about 9,000 pt of swiping without an end, open a World after cycling.
    - **Layouts:** You labels on one line, profile actions.
    - **Responsive** at **390×844, 402×874, 430×932**: tabs fit, cards full width, Drift fills the screen, the graph uses the real width and scrolls endlessly, covers crop to fill, You labels on one line, profile actions readable, chat composer on screen.
  - **Earlier web suites:**
    - 6B REAL flow: **33/33** (with its Happening-feed and `/drift` checks updated to the 6C design)
    - account switching: **3 full cycles**, no crash
    - chat (3 browsers): **38/38**
    - Demo sweep: **0 errors**
    - The only console noise is still the web-only "nested button" warnings in older cards.
- **Not run:**
  - The real Supabase project.
  - Expo Go on an iPhone.
  - Real Dynamic Type (the web can't emulate it; the one-line labels use capped scaling, checked by measurement at default size).
  - Real safe areas (web insets are 0).
  - H.264 playback (iPhone only).
  - Chat and video must be proven by the two-phone tests below.

## Changed files

**New (8):**

- `supabase/migrations/0003_phase6c.sql`
- `src/components/drift/DriftPager.tsx`
- `src/components/media/ChimpVideo.tsx`
- `src/graph/live.ts`
- `src/services/backend/realCache.ts`
- `src/utils/buzzRows.ts`, `src/utils/id.ts`, `src/utils/startup.ts`

**Modified (36):**

- **Project:** `package.json`, `package-lock.json` (expo-video), `app.json` (expo-video plugin)
- **Routes:**
  - `app/_layout.tsx`
  - `(tabs)/`: `_layout`, `boards`, `buzz`, `drift` (redirect → Buzz → Drift), `happening`, `you`
  - `board/[id]`, `create/buzz`, `profile/[id]`
- **Components:**
  - `boards/BoardHero`, `buzz/BuzzCard`, `happening/HappeningGraph`, `media/MediaViewer`
  - `profile/YouParts`
  - `ui/Segmented`, `ui/misc`
- **Graph:** `graph/graph`, `happening`, `surfaces`, `worlds`
- **Services:** `lib/supabase`; `services/backend/content`, `mappers`, `media`, `realData`; `services/create`, `dataset`, `repository`
- **Store and types:** `store/useChimp`, `useMediaViewer`, `useSession`; `types/models`
- **Docs:** `README.md`, `BUILD_NOTES.md`

**Unused, safe to delete by hand:** `src/components/happening/FeedTile.tsx` (the old Happening masonry tile; it still compiles).

## Known limitations (Expo Go / Supabase Storage)

- **Video compression:**
  - It asks the iOS picker to re-encode to 960 × 540 (`videoExportPreset`). Apple has deprecated that setting, and I couldn't confirm on a device that Expo Go still applies it.
  - If a phone hands over the original, a long 4K clip can exceed 50 MB. You then get a clear "pick a shorter clip" message, and nothing is posted. Test 4 shows which happens (check the size in Supabase → Storage).
- **Poster frames:** made on the phone. If making one fails, the card shows a dark frame with a play badge.
- **Uploads:**
  - There's no background upload: stay in the composer until it posts.
  - Progress is shown for the clip upload (native).
- **Storage:**
  - Clips live in the public-read `media` bucket under unguessable paths, like photos (as in 6B).
  - The project-wide upload limit in Supabase Storage settings can be lower than the bucket's 50 MB.
- **Other people's likes** refresh on load, on pull to refresh, and every 60 s while Trending is open. There's no Realtime for likes.
- **iOS silent switch:** not changed in this phase; please check it. Drift starts muted either way.
- **Demo** video posts keep the local file on the phone (Demo is local by design).

## What to test on your iPhone 12 (and a friend's phone)

**Setup:**

1. Run `0003_phase6c.sql`.
2. Run `npm install`.
3. Run `npx expo start -c`.
4. Open Expo Go on two phones: you (A) and a friend (B), both REAL accounts.

**Tests:**

1. **Startup:**
   - Force-quit, then open. Buzz should appear with content almost at once: no "One moment…", no Welcome, no Demo, no empty flash.
   - Watch Metro for the `[chimp:startup]` lines and note the numbers.
2. **Buzz order:**
   - Post "One", wait 5 s, post a photo "Two", wait 5 s, post "Three". For You shows Three, Two, One at the top.
   - Following shows them newest first.
   - Trending keeps liked posts above them.
3. **Trending:** B likes one of A's posts. On A, switch to Trending: it moves up (within a minute, or at once on pull to refresh).
4. **Video, standalone:**
   - Composer → Video → pick a clip of 10–30 s → "Made it to Niagara" → Post. Check the progress %.
   - It shows as a poster card in Buzz. Tap it: it plays with sound; mute, pause, swipe down.
   - Force-quit and reopen: it's still there.
5. **Video failure:**
   - Start a video post and turn on Airplane mode mid-upload. You get a plain error, nothing is posted, and your clip and caption stay.
   - Turn Airplane mode off → Post: it posts once.
6. **Too long:** pick a clip over 60 s. You get a clear message, and nothing uploads.
7. **World video:**
   - Niagara Falls Trip → **Add video** → a clip → Post. It's in the World.
   - B opens the World, plays it, likes it and comments.
8. **Cover:**
   - On your World, tap the **camera** button on the hero → a Niagara photo.
   - The hero, its card in Boards and the World chip in Drift/pickers show it.
   - Replace it: the new one shows everywhere.
   - Force-quit and reopen: it's still the new one.
   - B can't change it (no camera button for B).
9. **Buzz → Drift:**
   - Swipe through 10+ items. Only the visible clip plays and the previous one pauses; it starts muted, unmute works.
   - Like, save, comment and "Not for me" (with Undo).
   - The creator opens their profile, and Back returns to Drift.
   - A World chip appears only on World items.
   - Switch to For You: clean.
10. **Happening:**
    - Swipe the graph left for a long time: it keeps going, with no jump and no overlaps.
    - Tap a World after several cycles: that World's branch opens.
    - Stories row, then "Live across your graph". There's no photo grid.
11. **You:** Followers / Following / Connections / Matches stay on one line, in both the stats row and the tiles. Also check with Settings → Display & Brightness → Text Size and Larger Text.
12. **Profiles:** open Maya (Demo) and B (REAL). Connect, Message and ••• are readable, with Crush on its own row when eligible.
13. **Account switching:** REAL → Demo → REAL → sign out → sign in, twice. No crash, and nothing of one account shows in the other.
14. **Chat:** repeat the 6B two-phone test (A → B message, unread badge, reply live, request, block).
15. **Safe areas:** on a Dynamic Island iPhone, if you have one, Drift's top tabs, mute button and bottom controls clear the island and the home indicator. Check After Dark too.

---

# Chimp build notes — prototype v0.6B — Niagara alpha stabilization

25 Sep 2026 · Code in `C:\Users\AI Admin\Documents\Chimp` · Expo SDK 57, Expo Router, TypeScript, Zustand, Supabase (Auth, Postgres, Storage, **Realtime**). Still Expo Go only, with **no new packages**. The v0.6A notes follow below.

6B makes Chimp simpler and sturdier for a small group of real friends: the Niagara alpha.

| Surface | What it is |
|---|---|
| Boards | Intentional Worlds |
| Buzz | Conversation. A World is optional. |
| Happening | The living Opportunity Graph, plus the visual activity that used to be Drift |
| You | Identity, relationships, your agent, and now Messages |
| After Dark | A separate mature world, unchanged |

On top of that, 6B adds real-time chat between real accounts.

## Lint hardening (after 6B)

- **Setup:** `npx expo lint` set up Expo's standard ESLint (`eslint` ^9 and `eslint-config-expo` ~57.0.2 in devDependencies, plus the template `eslint.config.js`). That's all kept.
- **Result:** `npx expo lint` finds **0 problems** (it was 49: 35 errors, 14 warnings), and `npx tsc --noEmit` is clean.
- **No rules were disabled or suppressed**, in the config or in files.
- **Reanimated:** shared values now use `.get()` / `.set()` instead of `.value`, in `MediaViewer`, `StoryViewer` and `Tap`. That's Reanimated's documented React-Compiler-compatible API, and the values stay on the UI thread (they are not React state).
- **New:** `useDataset()` (`services/dataset.ts`) gives screens the active dataset as React state. `useNow()` (`hooks/useNow.ts`) replaces `Date.now()` during render.
- **Re-verified on web:** REAL flow 34/34, chat 38/38, account switching 3 cycles, Demo sweep 0 errors.

## What you must do once

1. **Supabase → SQL Editor:** run `supabase/migrations/0002_phase6b.sql`. Run it after 0001; running it again is safe. It adds:
   - the chat tables and their Row Level Security
   - mutual connections (`request_connection`)
   - server-side blocks
   - the `allow_message_requests` profile column
   - Realtime publication of `messages` and `conversation_members`
   - the chat photo folder in Storage
2. Nothing else changes:
   - `.env`: no new variables (`EXPO_PUBLIC_ENABLE_TEST_AUTH` from 6A still applies).
   - Packages: no new ones, so no `npm install` is needed.
   - The local store keeps version 6: nothing is reset or migrated, and your Demo and REAL data stay as they are.
3. **Restart the app:** `npx expo start -c`.

If Realtime seems quiet, open Supabase → Database → Publications → `supabase_realtime` and check that `messages` and `conversation_members` are ticked. The SQL does this, but it's worth a glance.

## 1. The logout / Demo crash (`Cannot read property 'id' of undefined`)

**Root cause.** An account change swapped two things in separate steps while the tab screens stayed mounted:

- the local graph store's bucket (joins, saves, follows, crushes), and
- the active dataset (the Worlds, people and content those ids point at).

Between the two steps, screens rendered one account's ids against the other account's dataset. For example, going from REAL to Demo loaded the Demo bucket, and its crushes on `u_maya_t` were resolved while the REAL dataset was still active. The path was `ctx.match` → `explainPerson` → a shared World lookup (`repo.board(id)!`) → `undefined.id`. It showed on the You tab in `scoreBoard`/`relevance.ts`, and it happened in the reverse direction too. A refresh "fixed" it because both halves then loaded together.

Reproduced here on the 6A code: `Cannot read properties of undefined (reading 'id')` on the first REAL → Demo switch.

**Fix: an explicit transition lifecycle** (`store/useSession.ts`).

- **Every change goes through `transition(label, swap)`** — enter REAL, enter Demo, leave Demo, sign out:
  1. `status → 'switching'`. The root layout renders a transition screen instead of the navigator, so every app screen is unmounted.
  2. Wait for that commit.
  3. Run the account teardowns: chat Realtime is closed and the media viewer is closed (`onAccountChange`).
  4. Set the neutral **empty dataset**. It has nobody and nothing, so no id from either account can resolve.
  5. Swap the store bucket.
  6. Publish the new, complete dataset.
  7. Set the final status (`ready` / `signedOut`).
  8. The navigator remounts fresh: the gate sends you to Buzz or Welcome.
- **Serialized.** A second change waits for the first to finish.
- **Never stuck.** If a change fails it lands on Welcome, never on the transition screen.
- **Sign out** also removes the Supabase session.
- **Development logs** trace each step, for example:

  ```
  [chimp:session] enter DEMO: start {"from":"real"} → [chimp:dataset] demo v7 · me=user:none … → bucket chimp-store → [chimp:dataset] demo v8 · me=u_wollymc · 20 boards → done
  ```

**Hardening** (defence in depth, not the fix):

- `scoreBoard` returns a zero score for a missing World (with a dev warning), and `rankBoards` skips it.
- All the `repo.board(id)!` / `repo.move(id)!` assertions in the graph now skip missing entities: shared Worlds, related Worlds, shared Moves, loop candidates, Happening branches and anchors.

**Verified.** Three full cycles of REAL → Demo → leave → REAL → sign out → sign in → Demo → leave → REAL, all by tapping through the app with no reloads: no crash, no page errors, and every screen shows the right account.

## 2–4. Buzz without a World, simpler composer, captions under photos

- **Data.** `buzz_items.board_id` was already nullable, and RLS already treated NULL as visible, so no migration was needed. In the app, `boardId: ''` means "Just Buzz". A Buzz with no World still feeds the graph: its interests are inferred from its words (`utils/inferInterests.ts`, e.g. "absolute cinema" → Films). Following now includes your own posts and people you follow, whatever the World. Existing World-linked Buzz is unchanged.
- **Composer** (`app/create/buzz.tsx`):
  - One box, "What's buzzing?", then optional **Camera / Photos** (up to 4), **Poll** and **World**.
  - It posts as Just Buzz until you attach a World. "Post here" on a World pre-attaches it.
  - There's no Meme type: a meme is a photo with a caption.
  - The kind is derived: poll / photo / note (more than 500 characters) / post.
- **Photo posts** (`BuzzCard` → `MediaCard`):
  - The photo is shown untouched, at its real aspect ratio: 0.8–1.91 from the stored media dimensions.
  - Multiple photos are a swipeable carousel with dots.
  - The caption sits **under** the image as a bold editorial line (long captions read as text), followed by `wolly · Just now · [Films]` and then the actions.
  - Legacy "meme" text on Demo fixtures is shown the same way. Nothing is painted over media anywhere, including Drift tiles and the Drift viewer.
- **No nested touchables** in the Buzz card, so it's clean on web and predictable on iOS.
- **Tagline:** "Thoughts. Photos. Takes. Real people."

## 5. Media viewer

`components/media/MediaViewer.tsx` plus `store/useMediaViewer.ts`.

- **Not a route.** It's one global modal mounted at the root; tapping an image only sets state. Tapping the same image 10 times opens one viewer, pushes no history entries, and closing returns you exactly where you were.
- **The original bug:** the Buzz card pushed `/buzz/[id]` on every tap, even inside the detail screen, so screens stacked. Cards never navigate to themselves now, and `utils/nav.ts → pushOnce` also swallows rapid double taps on every link.
- **Viewer features:**
  - pinch to zoom (1–5×) and double-tap zoom
  - pan while zoomed
  - swipe between a post's images (paging pauses while zoomed)
  - swipe down, ✕ or Android Back closes it, once
  - dark background, original aspect ratio (from the media row, or measured on load), minimal caption and author
- **Tech:** gesture-handler and Reanimated only, so it works in Expo Go. Video can reuse the same frame later.

## 6. Optimistic replies and comments

- **Why replies needed a refresh.** In REAL, replies lived in the dataset, but the thread's `useMemo` only depended on the Demo-only local list, and the count came from the item's static `replyCount`.
- **Now:**
  - The thread and every card read the live dataset (`useReplyCount`).
  - A reply appears instantly as "Sending…", the count goes up, and the empty state disappears.
  - Supabase confirms it and the temporary reply is swapped for the real row.
  - **If it fails, the reply is rolled back**, the count drops, your text is put back in the box, and "Your reply didn't send. …" appears.
- **Drift / World comments** (`/comments/[postId]`) work the same way.
- **Timestamps:** `utils/format.ts → whenLabel` shows **Just now · 5m · 2h · Yesterday · Sep 24** (with the year if it's a different year). No raw ISO strings anymore; the 6A reply mapper used `created_at.slice(0,16)`.

## 7. Drift merged into Happening

- **Tabs:** **Boards · Buzz · Happening · You · After Dark.** Buzz is still the landing tab.
- **Happening, top to bottom:**
  1. The Opportunity Graph.
  2. **Friends & Connections**, in one row: your story plus "Add", friends' stories, friends without a story (their profile), then your Worlds' stories.
  3. **Why this matters to you**, the top 3.
  4. Moves, only when they're tied to your Worlds.
  5. **For you · Happening now**: the visual stream. It mixes Drift photos, carousels and videos with photo Buzz, ranked by the same scorers and interleaved. Every tile says **why it's there**, for example "Priya posted", "Because you're into Films", "From Niagara Falls Trip, a World you joined" or "Trending in Travel". It's a two-column masonry that loads 20 at a time. Captions sit under the image.
- **Nothing lost or broken:**
  - Drift items still open in the full-screen viewer (`/drift/[id]`, now titled Happening), with like, save and comment.
  - "Photos in a World" (the old New Drift) still posts into a World and shows up here.
  - The old `/(tabs)/drift`, `/stories` and deep links redirect to Happening, so a saved or old link can't open a missing tab.
  - The Drift data model, scoring and user-created Drift media are untouched.
- **After Dark stays out:** it's excluded from the feed and the graph as before.

## 8. Happening graph: lanes

`graph/happening.ts` and `HappeningGraph.tsx`.

- **Before:** Worlds sat 108pt apart, but "strong" nodes were placed at x−18, open branches at x+100, and labels up to 132pt wide, with nothing reserving that space. Neighbouring Worlds' nodes and labels collided.
- **Now each World owns a lane**, an exclusive horizontal band:
  - **Lane width** comes from label widths: the major label box (132pt) or two supporting boxes side by side (2×92 + gap), whichever is wider, plus padding.
  - **Inside the lane:** the World sits on the top or bottom row (alternating, so it still zig-zags). Its supporting nodes (the chain node plus the "strong" node) sit on the opposite row of the same lane, side by side.
  - **Opening a World** widens only its own lane: up to 4 branches per column, up to 2 columns, strongest first, spread over fixed slots. Everything to the right moves over.
  - **Scrolling snaps to lane edges**, so the leftmost World is never cut in half. A World cut off on the right is deliberate: it signals the graph continues.
  - Supporting nodes now always show a label, which fits because space is reserved.
- **Verified by a box-overlap test:** every node circle and label box against every other, and against the canvas edges. It covers Demo collapsed plus each of its 10 Worlds opened, and REAL with 8 Worlds plus a user World, each opened. Result: **0 overlaps, 0 out of bounds.**

## 9. You: "Connections" on one line

- The label's font size now comes from the measured cell width, up to 12pt and down to 9.5pt at most.
- It no longer relies on `adjustsFontSizeToFit`, and its text scaling is capped. That's what was breaking the word across two lines on the iPhone when text size is larger than default.
- Checked: Followers, Following, Connections and Matches each render on one line.

## 10–11. Tagline and landing tab

- The Buzz tagline is "Thoughts. Photos. Takes. Real people."

- The gate routes to `/buzz` after sign-in, onboarding and every account change.

## 12. Niagara readiness (nothing Niagara-specific in code)

- **New World:**
  - name
  - "What's it for?" (e.g. "Weekend Niagara trip with friends.")
  - category (Travel)
  - new: **Also about** — up to 3 more interests, e.g. Food and Photography
  - cover
  - public / private
- **No fake members.** The World hero no longer invents "+2" member bubbles (it used `extra || 2`). The meta line shows real members ("1 member"), and People reads "Just you so far" until friends join.
- **A World's Today edition** rebuilds when content changes, so your new post shows immediately. Likes and saves still don't reshuffle it.
- **Already there from 6A:**
  - join / leave / save
  - Post here · Add photos · Add to Story
  - replies and comments
  - the member list
  - Board activity in Happening
- **Nightlife isn't offered** under "Also about", so After Dark stays separate. There's no "Road Trips" interest; Travel covers it.

## 13. Real people only

- REAL accounts still start at 0 followers, following, connections and matches, and no Demo person appears anywhere. The web runs check every screen they visit.
- **Connections are now mutual for real** (`request_connection`):
  - If you tap Connect and they haven't asked, it becomes a request.
  - If they already asked, it becomes a connection. Their profile shows **Accept** in that case.
  - Your connections, requests both ways, and blocks load from Supabase at sign-in.
  - Blocking is stored server-side, and it also removes follows and connection requests.

## 20–26. Real-time chat

**Data model** (`0002_phase6b.sql`):

- **`conversations`:** id, kind (`direct`), `direct_key` (one conversation per pair), `updated_at`, `last_message_id`.
- **`conversation_members`:** `conversation_id`, `user_id`, `joined_at`, `last_read_at`, `status` (active / request / declined / left).
- **`messages`:** id, `conversation_id`, `sender_id`, `body`, `media_id`, `message_type` (text / photo), `client_id`, `created_at`, `edited_at`, `deleted_at`.
  - `client_id` has a unique index, so a retried send can never create a duplicate.

**RLS and RPCs** (all security definer, all checked):

- **Reading:** only members can read conversations, members and messages. Guessing a conversation id returns nothing.
- **Sending:** only as yourself, only as a member, never across a block, and not in a request you declined (until you accept it).
- **`message_status` / `can_message`:**
  - **active:** you're connected, follow each other, or have a mutual Spark. A one-way Crush is never revealed.
  - **request:** you share a World, or they allow message requests (the default; `profiles.allow_message_requests`).
  - Otherwise not allowed.
- **`start_direct_conversation`:** idempotent. The other side's status is `active` or `request`.
- **`mark_conversation_read`, `respond_to_request`.**
- **`my_conversations`:** the other person, last message, time and unread count. People you blocked are hidden.
- **Trigger on a new message:** bumps the conversation, and replying to a request accepts it.

**Realtime.** One channel per signed-in account listens to `messages` inserts and member changes. Supabase Realtime enforces the same RLS, so you only receive your own conversations. There's no polling: the app catches up once when it returns to the foreground and when the channel reconnects. The channel is torn down on sign-out and on every account switch.

**Client:**

- **`services/backend/chat.ts`:** the Supabase side.
- **`store/useChat.ts`:** live and optimistic state, not persisted, because Supabase is the source of truth.
- **Screens:**
  - **`/messages`:** Chats / Requests (n), each row with avatar, name, last message ("You: …"), time and an unread badge.
  - **`/chat/[personId]`:** real-time chat for REAL accounts (`components/chat/RealChat.tsx`):
    - Your message appears at once as "Sending…" → the time. If it fails: "Not sent · Tap to retry" (same `client_id`, so never duplicated).
    - Newest messages sit at the bottom (inverted list), keyboard-aware, with day separators.
    - Tap the header to open the profile.
    - A request banner offers Accept / Decline. "Sent as a message request…" shows on the sender's side.
    - One photo per message, stored at `media/chat/{you}/…`; tap it to open the viewer.
    - If you blocked them, sending is disabled.
- **Entry points:**
  - You → **Messages**. Your own profile no longer says "Start Chat". The unread count also lights the You tab dot.
  - Another person's profile → **Message**.
  - Connections, People You Should Meet and a World's People tab → their profile → Message.
  - The New message picker lists Recent, Connections, Following and In your Worlds.
- **The Demo account** keeps its local, simulated chat. It never touches Supabase chat, and REAL chats never appear in Demo.

## Verification (what actually ran)

- **TypeScript:** `tsc --noEmit` is clean. Lint can't run here (it downloads its config).
- **Postgres 16:**
  - 0001 + 0002 apply twice cleanly, and the Realtime publication gets both chat tables.
  - **Chat suite: 35/35 pass** with six users. It covers:
    - requests turning into connections
    - send and read, and unread counts
    - idempotent retry and sender spoofing
    - outsiders can't read, see or post
    - Message Requests, and replying to accept
    - requests off, shared World → request
    - decline, then accept
    - blocks both ways
    - mutual follow → active; a one-way Crush reveals nothing
    - the internal function isn't callable directly
    - chat photo folders
  - **The 6A suites are unchanged:** 31 pass, plus the same two known ordering artifacts.
- **Node scenarios:**
  - DEMO is unchanged: Japan Trip #5 → #3, Happening Japan 45 → 82, Maya Tanaka eligible.
  - REAL: 21/21.
  - Graph collisions: 0.
  - v5 → v6 migration OK.
- **Web builds** (dev and release) against a mocked Supabase. The mock includes a small Phoenix/Realtime server that pushes rows only to conversation members.
  - **Transitions:** 3 full cycles, no crash.
  - **REAL flow: 34/34 checks:**
    - Buzz with and without a World, photo Buzz, caption under the photo
    - 10 taps → one viewer → Back once
    - instant reply, count and "Just now"; failed reply rolled back
    - Happening graph plus feed; a tile opens → Back
    - old `/drift` → Happening
    - stats on one line
    - Niagara World with Also-about; Post here → shows in the World; honest People tab
  - **Chat: 38/38 checks** across 3 browsers:
    - A → B "Are we leaving at 7?" → B's unread badge without refresh → open → read on the server → "Yes" → A sees it live
    - 5 rapid messages, in order, no duplicates
    - dropped send → "Not sent" → retry exactly once
    - header → profile → Back once
    - relaunch: persisted, correct read state
    - C finds A through the Niagara World's members → Message Request → A's Requests (1) live → Accept
    - after a block, A can't message
    - entering Demo tears down A's Realtime; Demo shows no REAL chats; back to REAL, the chats return
  - **Demo route sweep:** 58 routes, 0 errors.
  - The only console noise left is web-only "nested button" DOM warnings in older cards (e.g. a Follow button inside a person row). They're harmless on iOS.
- **Not run:**
  - The real Supabase project and its Realtime service: my workspace can't reach supabase.co.
  - Expo Go on an iPhone.
  - Chat is **not** proven until the two-phone test below passes on your project.

## Changed files

**New (11):**

- `supabase/migrations/0002_phase6b.sql`
- `src/app/messages.tsx`
- `src/components/chat/RealChat.tsx`, `src/components/chat/RelationshipCard.tsx`
- `src/components/happening/FeedTile.tsx`
- `src/components/media/MediaViewer.tsx`
- `src/services/backend/chat.ts`
- `src/store/useChat.ts`, `src/store/useMediaViewer.ts`
- `src/utils/inferInterests.ts`, `src/utils/nav.ts`

**Modified (43, plus these docs):**

- **Routes:**
  - `app/_layout.tsx`, `app/index.tsx`
  - `(tabs)/`: `_layout`, `buzz`, `drift` (now a redirect), `happening`, `stories`, `you`
  - `board/[id]`, `buzz/[id]`, `chat/[id]`, `comments/[postId]`, `drift/[id]`, `profile/[id]`
  - `create/`: `buzz`, `drift`, `index`, `story`, `world`
  - `new-chat`
- **Components:** `TabBar`, `boards/BoardHero`, `boards/Edition`, `buzz/BuzzCard`, `create/CreateParts`, `drift/DriftTile`, `happening/HappeningGraph`, `profile/ProfileParts`, `stories/StoryViewer`
- **Graph:** `graph/happening`, `loops`, `relevance`, `surfaces`
- **Services:** `services/backend/content`, `mappers`, `media`, `realData`; `services/create`, `dataset`
- **Store, types, utils:** `store/useChimp`, `useSession`; `types/models`; `utils/format`
- **Docs:** `README.md`, `BUILD_NOTES.md`

## Known limitations

- **Realtime** on a real project isn't verified from here (see the test list).
- **Push notifications** aren't part of this phase. Messages arrive live while the app is open, and unread counts catch up when you return to it.
- **Chat:**
  - 1:1 only (the model allows groups later).
  - Text plus one photo per message; no video.
  - No typing or read indicators for the other person.
  - Messages can't be edited or unsent from the app yet (the columns exist).
- **Chat photos** live in the public-read `media` bucket under unguessable paths, like all other media. A private bucket with signed URLs is a later hardening step.
- **Profiles:** people you have no link to (no shared World, connection or follow) can't be opened by id. In the alpha you find each other through a shared World.
- **Web only:** some older cards still nest touchables, which gives DOM warnings on web.

## What to test on your iPhone 12 (and a friend's phone)

**Setup:** run `0002_phase6b.sql`, then `npx expo start -c` on the PC. Open it in Expo Go on two phones, or one phone plus a second session.

1. **Launch:** it opens on **Buzz**. The tabs are Boards · Buzz · Happening · You · After Dark.
2. **Buzz with no World:** type "absolute cinema" → Post, then a photo post with a caption. The caption sits **under** the photo, and it posts as Just Buzz.
3. **Buzz in a World:** "World" → pick one (or "Post here" inside a World). The chip shows on the card.
4. **Media viewer:**
   - Tap a photo: full screen, pinch, double-tap, pan, swipe between photos.
   - Swipe down or ✕ closes it, and you're exactly where you were.
   - Tap the same photo several times fast, then Back once.
5. **Replies:** open a Buzz → reply. It shows at once with "Just now" and the count goes up. Turn on Airplane mode and reply: it's rolled back, your text returns, and an error shows.
6. **Like / dislike / save** on a Buzz.
7. **Happening:**
   - Pan the graph: no overlapping circles or labels, and the left edge snaps cleanly.
   - Tap a World: its branch opens in its own lane.
   - Friends & Connections row, then the "For you" feed with reasons.
   - Tap a tile → Back.
8. **You:** Followers / Following / Connections / Matches each on **one line** (also try Settings → Display → Larger Text). The button says **Messages**.
9. **Account switching,** 3 times: Settings → Enter Demo Account → all tabs → Leave Demo → sign in → Sign out → sign in → Demo. No crash, no refresh needed.
10. **Niagara:**
    - Create "Niagara Falls Trip" (Travel, also Food and Photography, a cover). It shows "1 member" and "Just you so far" on People.
    - Your friend joins it from Boards and appears under People.
11. **Chat** (the Niagara test):
    1. A opens B's profile → Message → "Are we leaving at 7?"
    2. On B's phone, without refreshing, the You tab dot and the Messages badge light up. Open it: the message is there and the badge clears.
    3. B replies "Yes" and A sees it live.
    4. Send 5 quick messages.
    5. Force-close both apps and reopen: the conversation and read state are kept.
    6. Tap the chat header: it opens the right profile, and Back returns once.
12. **Message Request:** someone who's only in your Niagara World messages you. It lands in Messages → Requests. Accept, or just reply.
13. **Connections:** A taps Connect on B, then B taps **Accept** on A's profile. Both now show 1 Connection.
14. **Block:** B blocks A from A's profile (•••). A's next message says "Not sent", and B's list no longer shows A.
15. **Keyboard:** in chat and in the Buzz composer, the input stays above the keyboard.

---

# Chimp build notes — prototype v0.6A — Accounts & Creation

24 Sep 2026 · Code in `C:\Users\AI Admin\Documents\Chimp` · Expo SDK 57, Expo Router, TypeScript, Zustand + AsyncStorage, Supabase (Auth, Postgres, Storage). Still Expo Go only. The v0.5 notes follow below.

Phase 6A turns the prototype into something a real person can join. You sign up with your phone, set up a profile, pick what you're into, and land in Buzz with an honest, empty world that fills up as you create. The WollyMc fixture world is still there as the **Demo account**, used for development, Graph Debug and the scripted demo. The six tabs, the visual language and the Phase 3–5 Opportunity Graph are unchanged.

**New packages** (run `npm install`): `@supabase/supabase-js` ^2.117.1, `expo-image-manipulator` ~57.0.19 (bundled in Expo Go), `libphonenumber-js` ^1.13.14. No development build is needed.

## Backend architecture

```
Expo app ──► src/lib/supabase.ts (one client, AsyncStorage session)
  │            ├─ Auth: phone OTP (SMS)
  │            ├─ Postgres (PostgREST) with Row Level Security
  │            └─ Storage: one bucket, `media`
  │
  ├─ services/backend/auth.ts      phone formatting, send / verify code, sign out
  ├─ services/backend/content.ts   profile, load the account's world, create, sync
  ├─ services/backend/media.ts     pick → resize/compress → upload → `media` row
  ├─ services/backend/mappers.ts   rows ⇄ the app's existing Board / BuzzItem / DriftItem / Story / User
  ├─ services/backend/realData.ts  the in-memory REAL dataset built from rows
  ├─ services/dataset.ts           the ACTIVE dataset (DEMO fixtures or REAL rows)
  ├─ services/repository.ts        every screen and the graph read through ds()
  └─ store/useSession.ts           boot, sign in, onboarding, enter REAL / DEMO, sign out
```

- **The backend is the source of truth.** Zustand (`useChimp`) keeps what it always kept: optimistic flags, the private graph (affinity, activity, seen state), and caches. Every graph action in REAL mode also writes a row, fire-and-forget (`backend(label, fn)` in the store). A failed write logs a warning and never blocks the UI.
- **One read path.** `repo` and the graph read `ds()`, the active dataset. Graph caches key on `ds().version`, so switching accounts, or adding a post, rebuilds edges without special cases.
- **Configuration:** only public Expo env vars, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `…_ANON_KEY`), in `.env.local`, which is git-ignored. No secrets are in source. Without them the app still runs: the Demo account works and the phone screen says the backend isn't connected.
- **Not built (as agreed):** feed services, CDN, transcoding, push, payments, moderation, production AI.

## Auth flow

`/` is a gate (`app/index.tsx`). `Stack.Protected` keeps the auth group and the app group apart. SDK 57 has no `redirectTo` on guards, so a failed guard falls back to the gate.

1. **Welcome** (`(auth)/welcome`): "Chimp" wordmark, an original flat illustration (a chimp at a world portal, in the reference's navy / coral / peach palette), "People. Places. Ideas. A bigger you.", then **Sign Up** and **Sign In**. A "Developer: enter the Demo account" link appears in dev builds or when the backend isn't configured.
2. **Phone** (`(auth)/phone`): country picker (US, CA, GB, IN, NP, AU, DE, FR, JP, MX; easy to extend in `COUNTRIES`) with live formatting from `libphonenumber-js`. The number is converted to E.164. It needs a plausible length for the country (`isPossible`), so Supabase test numbers work. No number is hard-coded anywhere.
3. **Verify** (`(auth)/verify`): 6 boxes over one hidden input with `textContentType="oneTimeCode"`, so iOS offers the SMS code above the keyboard. The number is shown masked, with a 60 s resend timer and "Change number". Sign Up uses `shouldCreateUser: true`; Sign In doesn't create accounts. Errors are rewritten in plain language.
4. After verification, `useSession.signedIn` loads your profile. If it's incomplete, you go to the next onboarding step. Otherwise you enter the app.
5. **Session:** stored by supabase-js in AsyncStorage and auto-refreshed while the app is in the foreground. Relaunching goes straight to Buzz. **Sign out** is in Settings.

## Schema

`supabase/migrations/0001_phase6a.sql` can be re-run safely (`if not exists`, `drop policy if exists`). It's tested on Postgres 16 with stubbed `auth` and `storage` schemas.

| Table | Purpose |
|---|---|
| `profiles` | Primary key = `auth.users.id`. Holds username (citext, unique, `^[a-z0-9_.]{3,24}$`), display_name, avatar_media_id / avatar_url / avatar_focus_y, city, bio (≤280), profile_phrase (≤40), profile_emoji, open_to[], interests[], onboarded_at |
| `media` | owner, bucket, storage_path (unique), kind, mime_type, width, height, bytes |
| `boards` | Worlds. Text id, slug, title, tagline, category, interests[], cover/hero, theme_id, verb, visibility (public / private), type, owner_id (null = a Chimp World). The 14 catalog Worlds are seeded. |
| `board_memberships`, `board_saves` | Join / leave, and save |
| `buzz_items` | post / note / photo / meme / poll, body ≤2000, media_ids[], meme_text, poll jsonb |
| `poll_votes` | One vote per user per poll |
| `drift_items` | photo / carousel (video reserved), caption, media_ids[] |
| `story_items` | One row per frame, optional World, expires after 24 h |
| `comments` | Generic target: `buzz` / `drift` / `story` (`post` reserved) |
| `reactions` | like / dislike / save / repost. Private to you. |
| `follows`, `connections` (requested → connected), `crushes`, `open_loops` | The relationship graph |

These map to the brief's generic models: Profile, Board, BoardMembership, Post / BuzzItem, DriftItem, Story, Comment, Media, Follow, Connection, Crush, OpenLoop. The app keeps its existing TypeScript types, and `mappers.ts` converts between rows and types.

**Functions** (security definer):

- `can_see_board(id)`: public, owned by you, or you're a member.
- `can_see_target(kind, id)`: a comment is visible only if its Buzz, Drift or Story is.
- `my_sparks()`: returns people where the Crush is mutual, without revealing anyone's one-way Crush.

## Storage

- **Bucket:** one bucket, `media`, with public read (URLs are unguessable), a 10 MB limit and image/video MIME types only.
- **Paths:**
  - `avatars/{userId}/avatar.jpg` (re-uploads overwrite it, and the URL is cache-busted)
  - `posts/{userId}/…`
  - `drift/{userId}/…`
  - `stories/{userId}/…`
  - `boards/{boardId}/…`
- **Before upload**, every image is resized on the phone (`expo-image-manipulator`) to a capped long edge: avatar 1200, posts and stories 1600, covers 1800. It is re-encoded as JPEG at 0.8. iPhone originals are never uploaded as-is.
- **Metadata:** each upload records `media` metadata (path, mime type, width, height, bytes). Content rows reference media ids.

## RLS

- **Your own data:** you can edit only your own profile, media, content, reactions, votes, crushes and loops.
- **Content visibility:** you can see content in public Worlds, Worlds you own, and Worlds you've joined. Private Worlds, and their Buzz, Drift, Stories and comments, stay hidden from everyone else.
- **Storage uploads** are accepted only into your own folder (`avatars|posts|drift|stories/{your id}/…`) or `boards/{id}/…` for a World you own. There are no public writes.
- **Private relationship rows:**
  - Crushes are visible only to the person who sent them.
  - Sparks are computed server-side.
  - Dislikes are private reactions.
  - Connections are visible only to the two people involved.
- **Tested with two users (all pass):**
  - Can't create or edit another user's profile.
  - Can't edit another user's Buzz.
  - Can't upload into another user's folder or World.
  - Can't see a private World or its Buzz.
  - Can't read another user's dislike or Crush.
  - Can't create a Chimp World.
  - Can't join a private World uninvited.
  - Sparks appear only when mutual.
  - Comments: visible on public content, hidden in private Worlds; can't comment as someone else, into a private World, or on something that doesn't exist.

## REAL vs DEMO

| | DEMO (`chimp-store`) | REAL (`chimp-store:real:{uid}`) |
|---|---|---|
| Who | WollyMc fixture world | You, signed in with your phone |
| People | 20+ seeded people | Real accounts only |
| Content | Seeded Worlds, Buzz, Drift, Stories, Moves, news fixtures | The 14 Chimp Worlds + real rows |
| Counts | Seeded | Honest: 0 followers, following, connections, matches, Sparks until they happen |
| World Delta | Seeded change pool + reactions | Off (nothing fabricated) |
| Suggested Open Loops, Moves | Seeded | None (Moves aren't user-created yet) |
| After Dark threads | Fixture threads | "Quiet tonight" |
| Chat | Simulated replies | Saved on this device, no simulated replies |
| Graph Debug | Demo path, scorecard, time travel | Account + Crush diagnostic; demo tools hidden |

- Each mode has its own persisted bucket, so the two never mix. Switching swaps the bucket name and rehydrates it, or starts it fresh.
- **Enter the Demo account:** Settings → Developer → **Enter Demo Account** (from REAL; signs you out first), or the dev link on Welcome. Leave it with Settings → Account → **Leave Demo**.
- **Reset demo** exists only in DEMO. It also restores the fixture Open To.
- A REAL scenario test checks there's no fixture user id or name on any surface. The web run found none on 19 routes.

## Onboarding

Steps, with progress dots and the same dark palette:

1. **Make it yours** (`(auth)/profile-setup`):
   - Photo from Camera or Photo Library, with framing chips (Top / Upper / Center / Lower).
   - Display name.
   - @username, with a live availability check (debounced; format `a-z 0-9 _ .`, 3–24).
   - City, and an optional bio.
2. **Your phrase** (`(auth)/phrase`): see below.
3. **What you're into** (`(auth)/interests`): pick 3–8 of the 14 Chimp Worlds. "Also join these Worlds" is off by default, so joining is your choice.
4. **Open to** (`(auth)/open-to`): Friends is pre-selected. **Dating and Casual are opt-in** and explained ("Chimp isn't a dating app…"). "Not looking" clears them.
5. **Enter Chimp** saves `onboarded_at` and opens **Buzz**.

- If you quit part-way, the next launch resumes at the first incomplete step (`nextStep(profile)`).
- Interests seed affinity from **your** choices only: 0.5 for the World's primary interest, 0.2 for its secondary. Nothing comes from WollyMc.

## Phrase and emoji

- `profilePhrase` and `profileEmoji` are real fields now (`profiles.profile_phrase`, `profile_emoji`). Nothing is hard-coded: WollyMc's "Good people, better plans ♡" is just his fixture data.
- **Phrase:** 40 characters max, with a live counter. The guidance says "about four words". Example chips ("Good people, better plans", "Coffee first, chaos later", …) fill the field.
- **Emoji:** a curated set of 15 (♡ ✨ ✈️ 🌙 ☕ 🎬 🚀 🌊 🌎 🎧 📷 🔥 🍜 🏔️ 💫) plus **More** for any emoji.
- **Live preview:** a mini You hero with your photo, handwriting, name and city.
- **Edit later:** Edit Profile changes phrase, emoji, photo, framing, name, city and bio. In REAL it uploads and saves to your account; in DEMO it saves on the device.

## Adaptive You hero

`ProfileHero` now has two modes:

- **Mode A: cutout.** The approved WollyMc look: transparent portrait over lavender with a halo. It's used only when a real cut-out asset exists (the fixture), and never depends on background removal.
- **Mode B: framed.** For any uploaded photo:
  - **Background:** the lavender gradient, plus the same photo blurred (radius 40, 45% opacity) and tinted, so the colours relate to the photo.
  - **The card:** a rounded portrait card (54% of the hero width, 4 pt white border, slight tilt, shadow) on the right. It's cropped with `contentPosition` from your **framing** choice (`avatar_focus_y`).
  - **The phrase:** fitted into the column on the left. It uses the largest handwriting size (27 → 17 pt) that wraps into three lines or fewer.
  - **Moments** stack underneath. A long phrase shows two moments instead of three.
  - **No photo:** a soft card with your initial.
  - **Readability:** the phrase is never over the photo, and the name sits on the white card body below a fade.

Checked with a busy, colourful landscape photo with the subject off-centre, and with a dark, low-contrast portrait. Real people's profiles (`profile/[id]`) use the same framed hero with their own phrase.

## Creation flows

Every composer is a modal with Cancel · title · action, and says which World it's posting in. The World you came from leads the picker. REAL uploads and writes rows; DEMO keeps creations locally (`created` in the store). Every creation is a `create` graph signal: +0.06 to the World's interests, and it shows up in the World's graph.

- **Entry points:**
  - the blue **+** in the Buzz, Drift and Boards headers
  - "What's buzzing?" on Buzz
  - "Your story" at the front of the Drift stories row
  - **Post here / Add photos / Add to Story** on every World's Today tab
  - `/create` (a sheet with all four)
- **Buzz** (`create/buzz`):
  - **Post:** up to 500 characters, optional photos.
  - **Note:** up to 2,000 characters.
  - **Photo:** 1–4 photos with a caption.
  - **Meme:** a photo with up to 120 characters of overlay text.
  - **Poll:** a question of up to 140 characters, and 2–4 options of up to 60 characters.
  - Your new posts are pinned at the top of Buzz for 30 minutes.
- **Drift** (`create/drift`): 1–6 photos (a carousel when more than one), with a caption. Video isn't built yet.
- **Story** (`create/story`): one photo and a caption. It's owned by you ("My story"), or by you and a World ("My story + a World"), and lasts 24 h.
- **New World** (`create/world`): name, tagline, a category (one of the Chimp Worlds, which sets its interests and BoardTheme), a cover photo and public / private. You're the owner and a member. It opens straight away and is linked to its parent World, so it appears in Happening and in rankings. A "Niagara Falls Trip" is just this: nothing in the code is Niagara-specific.
- **Join / leave / save** Worlds write memberships and saves.
- **Comments:**
  - Buzz replies are `comments` rows (`buzz`).
  - Drift has a new **Comment** action in the viewer (`/comments/drift:<id>`).
  - Comments load from the backend on open, post optimistically and survive a reload.
  - Board-post comments keep the seeded behaviour in DEMO. In REAL, a World's conversation is its Buzz.
- **Empty states** instead of fake content everywhere:
  - Buzz: "Buzz is quiet", with the compose row above it
  - Boards: "You haven't joined a World yet"
  - A World's Today tab: "Quiet in here" with **Post here**
  - A World's People tab: "Just you so far"
  - You: Known For, Agent, people and Open Loops
  - After Dark: "Quiet tonight"

## Happening integration

- DEMO keeps the seeded 10-World graph and the Phase 5 demo, unchanged.
- **REAL builds the graph from your affinity** (`happeningWorlds`):
  - Each Chimp World whose primary interest reaches **0.25** becomes a World node. That means everything you picked at onboarding, and later anything your activity heats up. It shows at most 8, strongest in the middle.
  - **Branches** are real: your Worlds and joined Worlds in that interest (by `scoreBoard`), one real person active there, and the latest Buzz.
  - A World with no members yet reads "Just getting started" rather than "0 exploring".
- **Creating** in a World raises its interest, so its node grows. A new "Niagara Falls Trip" World (Travel) appears as a Travel branch.
- The graph's caches key on the dataset version, so a new post or World shows up immediately.

## Crush bugfix (Maya Tanaka)

- **Diagnosis:** the eligibility logic was right. Crush needs **both** people open to Dating or Casual, nobody blocked, and not yourself.
  - Maya Tanaka's fixture is open to dating.
  - **Your** Open To is read from your persisted profile on the device, not from the WollyMc fixture. A device carrying an Open To without Dating/Casual hides the button with no explanation. That can come from an earlier build's saved profile or from editing it.
  - Reset demo restores the fixture Open To (friends, dating, collaboration, travel). *Correction to what I said earlier: Reset does restore it.*
- **Fix, without relaxing eligibility:**
  - `crushEligibility(ctx, id)` returns `{ eligible, reason, mine, theirs }`, where `reason` is `self`, `unknown`, `blocked`, `you_not_open` or `they_not_open`. `crushEligible` wraps it.
  - **Graph Debug → Account** shows your Open To, then for each person open to dating/casual (or with your Crush): their Open To, ✓/✕ and the reason.
  - **Profiles:** when the only thing missing is *your* Open To, the profile shows "♡ Crush appears when you're open to Dating or Casual too. Update your Open To on You."
- **Verified:**
  - DEMO: Maya Tanaka is eligible. Zara and Kenji aren't (`they_not_open`).
  - REAL: a real person open to dating shows `you_not_open` until you turn Dating on, then becomes eligible. You are never eligible (`self`).
  - A Crush alone never creates a Spark.

## Verification

- **TypeScript:** `tsc --noEmit` is clean.
- **Database:**
  - The migration applies twice cleanly on Postgres 16.
  - **RLS suites:** isolation, storage, sparks and comments all pass. Two checks in the first suite fail only because it inserts a Crush before the second user exists; the second suite repeats that check in the right order and passes.
- **DEMO scenario:** unchanged from Phase 5 after the dataset refactor:
  - Japan Trip #5 → #3
  - the same Today order
  - Happening Japan 45 → 82
  - Maya Tanaka eligible
- **REAL scenario:** 21/21 checks pass. They cover:
  - no dummy people or seeded content
  - zero counts and Sparks
  - affinity only from onboarding
  - Happening = the chosen Worlds
  - no fixture ids or names on any surface or in the agent
  - no fabricated changes
  - creating raises affinity and appears in the feed
  - a new World joins Happening
  - Crush reasons
  - REAL comments aren't stored locally
- **Migration:** a persisted v5 store keeps joins, follows, crushes, Drift views, focus and chats, adds `created` and `connectRequests`, and saves as v6.
- **Web smoke (DEMO):**
  - Fresh install lands on Welcome, and signed-out deep links go to Welcome.
  - The dev link enters Demo.
  - 56 routes, including every create screen and Drift comments, show **0 errors**.
  - `/welcome` and `/phone` redirect into the app while signed in.
- **Web run (REAL, against a mocked Supabase):** the full path works with **0 console errors**. It covered:
  - Sign Up
  - formatted phone
  - a wrong code shows an error
  - the right code
  - profile with photo upload, then phrase, interests and Open To
  - landing in Buzz
  - no fixture names on 19 routes
  - Buzz post, New World with cover, 2-photo Drift, Drift comment (persists on reload)
  - a real person's profile with the Crush hint
  - relaunch skips auth
  - sign out returns to Welcome
- **Not verifiable here:** a real SMS, a real Supabase project, and Expo Go on the iPhone. See the test list.

## Changed files

**New (32):**

- `.env.example`
- `supabase/migrations/0001_phase6a.sql`
- `src/lib/supabase.ts`
- `src/services/dataset.ts`, `src/services/create.ts`
- `src/services/backend/`: `auth.ts`, `content.ts`, `mappers.ts`, `media.ts`, `realData.ts`
- `src/store/useSession.ts`
- `src/data/worldCatalog.ts`
- `src/app/(auth)/`: `_layout`, `welcome`, `phone`, `verify`, `profile-setup`, `phrase`, `interests`, `open-to`
- `src/app/create/`: `index`, `buzz`, `drift`, `story`, `world`
- `src/components/auth/`: `AuthUI.tsx`, `ChimpWorld.tsx`, `Onboarding.tsx`, `palette.ts`
- `src/components/create/`: `CreateButton.tsx`, `CreateParts.tsx`

**Modified (43):**

- **Package:** `package.json`, `package-lock.json`
- **Routes:**
  - `app/_layout.tsx`, `app/index.tsx`
  - `(tabs)/`: `boards`, `buzz`, `drift`, `happening`, `you`
  - `after-dark/[section]`, `board/[id]`, `buzz/[id]`, `chat/[id]`, `comments/[postId]`, `drift/[id]`, `profile/[id]`
  - `edit-profile`, `graph-debug`, `settings`
- **Components:** `afterdark/AfterDarkWorld`, `happening/NodePanel`, `profile/ProfileHero`, `profile/ProfileParts`, `profile/YouCards`
- **Data:** `data/happening`, `interests`, `media`, `users`
- **Graph:** `graph/agent`, `changes`, `config`, `graph`, `happening`, `loops`, `relevance`, `surfaces`, `worlds`
- **Services, hooks, store, types:** `hooks/useGraph`, `services/recommender`, `services/repository`, `store/useChimp` (v6), `types/models`
- **Docs:** `README.md`, `BUILD_NOTES.md`

## Known limitations

- **Real SMS needs a provider.** Supabase phone auth needs Twilio, MessageBird, Vonage or Textlocal. Use Supabase **test phone numbers** to try it without sending SMS. OTP wasn't tested against a real project from here.
- **Other people:**
  - **Follows and connection requests** are stored. Accepting a request, and "connected" counts rising, is Phase 6B.
  - **Chat** with a real person stays on your device. Delivery is 6B.
  - **Likes on others' posts** are saved privately. Public like/reply counts aren't aggregated yet (0 is shown rather than a fake number).
  - **Crush / Spark** work server-side (mutual only). Nobody is notified, by design and because push isn't built.
- **Content:**
  - **Video** isn't built. Drift and Stories are photos only.
  - **Moves** and Open Loops suggestions are DEMO-only. REAL users can still add their own loops locally.
  - **After Dark** in REAL is the gated shell with no threads. Pseudonyms for REAL accounts are 6B.
- **Loading:** it takes the latest 300 rows per content type. There's no pagination or realtime; pull to refresh on Buzz.
- **Photos** for Chimp Worlds are still hot-linked Unsplash images.
- **Expo Go limitations:**
  - The camera and photo library need permission prompts in Expo Go; standalone builds will need the permission strings in `app.json`.
  - After adding keys to `.env.local`, start with **`npx expo start -c`**. Metro caches inlined env values, so a plain restart can keep the old (empty) ones.
- **Lint:** `npx expo lint` can't run here (it downloads its config). Run it locally.

## Developer test numbers (TEMPORARY, while Twilio toll-free verification is pending)

- **What:** five fictional numbers, **+1 555-555-0101 … 0105**, sign in with the fixed code **123456**. No text message is sent.
- **They are REAL accounts**, not Demo:
  - a real Supabase Auth user and session
  - the real profile/content tables, RLS and Storage
  - the normal onboarding
  - an honest empty social graph
  - no WollyMc / Maya / Zara data
- **How (no secrets in the app):**
  - The app makes the same Supabase phone-OTP calls as for any number.
  - Supabase's own **Test Phone Numbers and OTPs** setting skips the SMS for these numbers and accepts 123456.
  - `src/config/testAuth.ts` only decides whether the app allows these numbers, and adds on-screen notes:
    - the phone screen says "Developer test number: no text is sent. The code is 123456"
    - the verify screen says "Enter 123456"
    - Settings shows "Developer test account"
  - Any other code is rejected in the app before it reaches Supabase.
  - A test number is always allowed to create its account, even from Sign In.
- **The switch:** `EXPO_PUBLIC_ENABLE_TEST_AUTH=true` in `.env.local`. The bypass is active only when **both** are true: it's a development build (`__DEV__`, i.e. `npx expo start`), and the flag is `true`.
  - **Otherwise it's completely off:**
    - the app refuses these numbers
    - no OTP request is sent
    - a test session saved earlier is signed out at the next launch
  - Release builds are always off.
- **Real numbers are unchanged:** same code path, same copy, same Twilio/Supabase flow.
- **One-time Supabase setup:** Dashboard → Authentication → Sign In / Providers → **Phone**. Phone must be enabled with your Twilio credentials saved. Under **Test Phone Numbers and OTPs**, enter:

  ```
  15555550101=123456,15555550102=123456,15555550103=123456,15555550104=123456,15555550105=123456
  ```

  If the dashboard offers a "valid until" date for test OTPs, set one a few weeks out. If Supabase rejects a test number, the app shows this exact value to paste.
- **Remove when Twilio is approved:**
  1. Set `EXPO_PUBLIC_ENABLE_TEST_AUTH=false`, then restart with `npx expo start -c`.
  2. Delete the test numbers in the dashboard.

  Optional clean-up later: delete `src/config/testAuth.ts` and its few imports (`auth.ts`, `phone.tsx`, `verify.tsx`, `settings.tsx`).
- **Verified (web, against a mocked Supabase):**
  - **Development build, flag on:**
    - the note shows
    - a wrong code is rejected without calling Supabase
    - 123456 → onboarding → a real `profiles` row → Buzz
    - 0 / 0 / 0 / 0 counts and no fixture people on 8 surfaces
    - a real number in the same build keeps the normal copy and flow
  - **Development build, flag off:** the number is refused, 0 OTP requests, and a saved test session is signed out at launch.
  - **Release build, flag on:** refused.
  - The full real-number flow is unchanged, with 0 errors.

## Manual Supabase setup

1. Create a project at supabase.com (any region; the free tier is fine).
2. **SQL Editor** → paste all of `supabase/migrations/0001_phase6a.sql` → **Run**. It creates the tables, policies, functions, the `media` bucket and the 14 Chimp Worlds. Running it again is harmless.
3. **Authentication → Sign In / Providers → Phone:**
   - Enable it.
   - Choose an SMS provider (Twilio, MessageBird, Vonage or Textlocal) and paste its credentials.
   - Optionally add **test phone numbers** with fixed codes, e.g. a 555 number with code 123456, to test without SMS.
4. **Project Settings → API:** copy the **Project URL** and the **publishable key** (called the "anon" key in older projects). Never use the `service_role` / secret key in the app.
5. In the project folder, copy `.env.example` to `.env.local` and fill in:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
   ```

6. Run `npm install`, then `npx expo start -c`.

## What to test on your iPhone 12

1. **Fresh install:** delete Expo Go's data for Chimp (or reinstall Expo Go), then open the app. You should see **Welcome**: wordmark, chimp illustration, Sign Up / Sign In.
2. **Sign Up with your phone:** Sign Up → +1 formats as you type → Continue → the SMS arrives → iOS offers the code above the keyboard → it verifies automatically.
3. **Wrong code:** a wrong code shows a clear message. Resend unlocks after 60 s. "Change number" goes back.
4. **Profile:** take a selfie with **Camera**, then try **Photo Library** with a landscape or busy photo. Try the Top / Upper / Center / Lower framing. Pick a username; a taken one says so.
5. **Phrase:** about four words, the counter stops at 40, an example chip fills it, pick an emoji, try **More** with any emoji. Check the live preview.
6. **Interests:** Continue stays disabled below 3, and you can't pick more than 8.
7. **Open To:** Dating and Casual are off by default and the explainer changes when you turn one on. **Enter Chimp** lands on **Buzz**.
8. **Empty is honest:** Buzz shows the compose row and an empty state.
   - **You:** 0 Followers / Following / Connections / Matches, your photo in the framed hero, your phrase and emoji.
   - **No seeded people anywhere:** People, Happening, Drift and After Dark.
9. **You hero with different photos:** Edit Profile → try a dark photo, a bright one and a busy one, and change the framing. The phrase must stay readable and never overlap the photo.
10. **Happening:** only the Worlds you picked, strongest in the middle.
11. **Create:**
    - **Buzz:** a Post, a Photo post (2 photos) and a Poll. Each shows first in Buzz.
    - **Drift:** a 3-photo carousel. It opens in the viewer.
    - **Story:** "My story + a World". It shows in the stories row.
12. **New World:** create "Niagara Falls Trip" (Travel, a cover, Public). It opens, and you're the owner. On Today, tap **Post here**: the composer is pre-set to that World. The World also shows in Boards → Joined and as a Travel branch in Happening.
13. **Comments:** reply to your Buzz, and comment on your Drift (the new Comment button). Close the app, reopen: the comments are still there.
14. **Relaunch:** force-quit and reopen. You go straight to Buzz, signed in.
15. **Second account (optional):** sign up a second phone, or a Supabase test number, on another device. Each account sees the other's public posts, and the other's profile shows the framed hero.
    - **Crush:** turn Dating on for both accounts → Crush appears. Turn it off on one → the hint explains why it's gone.
16. **Demo:** Settings → Developer → **Enter Demo Account**. WollyMc, the cut-out hero and all Phase 5 behaviour are back. Graph Debug → Run all matches the Phase 5 table. Settings → **Leave Demo** returns to Welcome.
17. **Maya Tanaka (Demo):** Crush shows on her profile. If it doesn't, Graph Debug → Account shows why (usually your Open To); Reset demo restores it.
18. **Sign out:** Settings → Sign out → Welcome.

---

# Chimp build notes — prototype v0.5 — Phase 5 Living Worlds

24 Sep 2026 · Code in `C:\Users\AI Admin\Documents\Chimp` · Expo SDK 57, Expo Router, TypeScript, Zustand + AsyncStorage, Expo Go only (no new packages). The v0.4 notes follow below.

Phase 5 keeps the six tabs, the visual language and the Phase 3/4 Opportunity Graph. It changes where Chimp opens, rebuilds Happening as a horizontal interest graph, restores the approved You hero, puts Crush on eligible profiles and turns Boards into Living Worlds.

## Default route change

- `/` → **`/buzz`**. The `(tabs)` layout also sets `initialRouteName: 'buzz'`, and the legacy `(tabs)/pulse` now redirects to `/buzz`.
- The tab bar order is unchanged. Stack deep links are untouched (`/board/[id]`, `/profile/[id]`, `/chat/[id]`, `/drift/[id]`, `/buzz/[id]` …).
- The After Dark gate's "Not now" returns to Buzz.

## Happening redesign

- **Out:** the radial hub and the Chimp mark in the centre (`ChimpMark.tsx` is now unused).
- **In:** `components/happening/HappeningGraph.tsx`, which is a horizontal `ScrollView` over a canvas about 3 screens wide.
  - Links are drawn with `react-native-svg` S-curves; nodes are positioned absolutely with Reanimated layout transitions. There's no physics or force layout.
  - Links attach to node sides, and labels have a soft backing so crossings stay readable.
- **Model** (`data/happening.ts` + `graph/happening.ts`):
  - **10 Worlds:** Photography, Founders, Films, Travel, Japan, Food, Science, AI, Culture, Style. They zig-zag across two rows at fixed slots.
  - **Node types per World:**

    | Node | When it shows | Where |
    |---|---|---|
    | anchor sub-World | always | on the chain to the next World |
    | "strong" node | strength ≥ 62 | beside the World |
    | 2–4 branches | when you open it | a column to the right; the graph slides over |

  - **World strength** = 0.75 × top affinity + 0.25 × average, + 8 per piece of evidence in the branch (joined or saved Worlds, people you follow, Moves), − 6 per dislike on its interests.
  - **Branch nodes** use `scoreBoard`, `scoreMove`, `scoreBuzz` and `explainPerson`.
  - **Badge** = unseen changes in the branch + Happening items in it.
  - **Avatar chip** = someone in the branch you follow, or a strong match.
- **Interaction:**
  - Tapping a World enlarges it, lights its links, dims the rest, opens its branch and shows **NodePanel**: kind, count, Why it's here, and Open / Join-Follow-Interested / Explore-Close.
  - Tapping it again closes the branch.
  - The open branch is persisted as `happeningFocus`. The first open of a branch is an `explore` signal (+0.03 to that interest).
- **Isolation:** After Dark never appears. Every node passes `isNightRef`, and nightlife and dating interests have no World.
- **Friends & Connections** is a smaller strip below. The "Why this matters to you" list is trimmed to the top 4, and Moves in your Worlds follow.

## You restoration

- **Hero:** `ProfileHero` leads again: the WollyMc cut-out over lavender, "Good people,↵better plans ♡" in Caveat, and stacked moments (Travel / Japan / Nightlife / +2). Below it: the large name, Boston, MA, bio, Known For and the four stats, plus Start Chat and •••.
- **Live bits:**
  - Moments keep the approved order, but interests that have heated up (affinity ≥ 0.6 and above their seed) move to the front.
  - Known For promotes matching items, and an "Into lately" line shows the hot interests.
- **Below the hero:**
  - Open To summary + Sparks (only if > 0)
  - Saved Boards / Your Boards
  - Open Loops
  - Your Agent
  - People You Should Meet (photo cards)
  - the full Open To card
  - Connections / Matches tiles
  - interests and prompts
- **Removed:** the generic `ProfileCard` and `CrushNote`, which showed a Crush count.

## Crush / Spark behaviour

- **Eligibility:** `crushEligible(ctx, id)` requires that you and they are both open to dating or casual, nobody is blocked, and it isn't you.
- **Profile action row:** Connect · Message · ♡ Crush (only if eligible) · •••. The ••• menu has Follow/Unfollow and Block.
- **Crush is private.** It sets a flag only, with no activity event, no affinity change and nothing sent. Your own note reads "Crush saved privately. Maya isn't told anything unless it's mutual."
- **Spark** = your Crush + theirs + still eligible. The copy is "You and Maya have a Spark", with no order. It appears on the profile, at the top of Happening's list and as a count on You.
- **Openers** (`MatchExplanation.openers: { context, draft }[]`) come from:
  - a poll you both answered (agree or disagree, using the seeded `OTHER_VOTES`)
  - a shared Move or shared World
  - their post
  - a possible Move
  - a shared interest

  Nightlife Worlds are excluded, and there are no pickup lines. Tapping one opens chat with `draft` pre-filled; it's never auto-sent. `starters` (drafts) is kept for compatibility.
- **Seed:** Maya Tanaka is now open to dating. `CRUSHES_ON_ME` = Maya Chen, Leah, Maya Tanaka.

## Living Board architecture

- **Tabs:** Board detail has **Today · Explore · People** (`BoardTab`). Legacy `?tab=posts` → Today; `albums` and `tips` → Explore.
- **`graph/worlds.ts → buildEdition(ctx, boardId)`** returns `{ lead, modules[], topics[], freshCount }`:
  - **Items** are scored with the shared scorers (`scoreBuzz`, `scoreDrift`, the new `scorePost`, `scoreStory`), + topic affinity × 10 (`data/editions.ts` topics and item → topic tags).
  - **Lead** = the best of the top news (+4), top video (+0), top photo post (−2).
  - **Modules:** Buzzing (relevance + heat), News (3–5), Top post, Watch, Stories, From your people (followed, connected or matched people active here, with what they did), Trending (topics in your order + related sub-Worlds, no duplicates).
  - **Module score** = editorial base (Buzzing 60, News 58, Top 55, Watch 50, Stories 46, People 44, Trending 40) + personal boost (your actions inside this World: watch +8 each, saves/likes +6, Buzz +5, people +6, capped at 20) + 0.1 × best item score. A module moved up by your actions shows "Moved up · …".
  - The edition is frozen while you read it (`useState`) and refreshes on your next visit.
- **`buildExplore(ctx, boardId)`** interleaves every format by score, with no two of the same type in a row and a photo grid after four items. It then appends each related World behind a "More from …" marker. The UI pages 12 at a time and loads more near the bottom.
- **UI:** `components/boards/Edition.tsx` holds `TodayEdition` (masthead, cover, modules, "You're caught up") and `ExploreStream`.
- **Discovery rack:** the Boards tab is unchanged.
- **News** stays `news.demo: true` with source "Demo source", and the UI says "prototype fixtures, not live reporting".

## Graph changes

- **Interests:** `i_film` (seed 0.40) and `i_science` (0.20). New Worlds: **Indie Film** and **Space**, with Buzz and Drift. New Japan content: 3 demo news items, a meme, a food post, Maya's Kyoto poll, the depachika video.
- **Activities:** `watch` +0.03 (the Drift viewer, after 1.5 s on screen, once per item) and `explore` +0.03 (first open of a Happening branch). Watched Drift counts as World evidence and as own engagement (0.3) in `scoreDrift`.
- **`GraphState` / memo keys** add `buzzVotes`, `driftViews`, `boardVisits`, `exploredNodes`, `happeningFocus`. `useSignals` now selects `graphStateOf` with a shallow compare.
- **Config:** `EDITION` and `HAPPENING_GRAPH` added.
- **Agent baseline** adds the Japan Trip Today order and the Happening World strengths. The Happening Spark item uses opener contexts.
- **Store v5.** Nothing is reset:
  - Adds `driftViews`, `boardVisits`, `exploredNodes` and `happeningFocus`.
  - Seeds only the missing affinity keys.
  - New actions: `watchDrift`, `visitBoard`, `exploreBranch`, `collapseBranch`.

## Phase 5 demo

Reset, then Graph Debug → Run all, or by hand:

1. Open Japan Trip.
2. Watch Ninenzaka in Drift.
3. Like Maya's Kyoto Buzz post.
4. Save the Kyoto Temple Walk.
5. Tap Japan in Happening.
6. Follow Maya Tanaka.
7. Dislike Lena's Style post.

Scripted results:

| Metric | Before → after |
|---|---|
| Japan affinity | 0.45 → 0.66 |
| Travel affinity | 0.50 → 0.62 |
| Food affinity | 0.42 → 0.54 |
| Style affinity | 0.15 → 0.11 |
| Japan Trip (Boards) | #5 → #3 |
| Japan Trip Today order | Buzzing › News › Top › Watch › People › Stories › Trending → Buzzing › **Top** › **Watch** › News › People › Trending › Stories (moved-up notes on Top, Watch, People) |
| Drift | the Ninenzaka video #9 → #4 |
| Buzz For You | the Kyoto post #12 → #3, and Maya's Kyoto poll enters the top 4 |
| Style post | #8 → #23; the Style meme #19 → #22 |
| Happening Japan | strength 45 → 82 (rank #6 → #2), branch open: Japan Trip, Tokyo, Maya, Tokyo Food Tour |
| Maya Tanaka match | 44 → 49% |
| You | Japan moment first, "Into lately: Japan · Travel" |
| Agent | "Your Japan planning activity increased this week" |
| Crush on Maya Tanaka | Spark, with starters from shared context ("You disagreed on Maya's Kyoto poll" after voting) |
| Crush on Zara (not eligible) | no Spark |

**Graph Debug** additions: the Japan Trip Today module ranking (lead, base + boost, topics), Happening World strength before → now, supporting and expanded nodes, links, focus, Sparks, Crush eligibility, Drift watched, Worlds visited, and Style affinity and Japan branch in the scorecard.

## Verification

- **TypeScript:** `tsc --noEmit` is clean.
- **Scenario test:** the demo results above. After Dark / nightlife never appears in the Happening graph (0 night nodes before and after).
- **Migration:**
  - v4 → v5 keeps profile, joins, saves, follows, chats, Buzz likes/dislikes/votes, Drift likes and crushes; Japan affinity stays 0.80, Films and Science are seeded, and the new actions work.
  - v3 → v5 still applies the Phase 3 reset path.
- **Smoke test:** 48 routes (including `/`, the new Worlds, legacy `?tab=posts`, and Maya Tanaka's profile) show 0 errors, both fresh and after the demo plus 3 h away.

## Changed files

**New (6):**

- `src/data/editions.ts` (World topics, item → topic tags, seeded poll votes, poll names)
- `src/data/happening.ts` (the seeded interest graph)
- `src/graph/worlds.ts` (Today edition + Explore)
- `src/graph/happening.ts` (the horizontal graph model)
- `src/components/boards/Edition.tsx`
- `src/components/happening/NodePanel.tsx`

**Modified (29):**

- **Routes:**
  - `app/index.tsx`
  - `app/(tabs)/_layout.tsx`, `pulse.tsx`, `after-dark.tsx`, `happening.tsx`, `you.tsx`
  - `app/board/[id].tsx`, `app/profile/[id].tsx`, `app/chat/[id].tsx`, `app/drift/[id].tsx`, `app/graph-debug.tsx`
- **Components:** `components/boards/BoardTabs.tsx`, `components/happening/HappeningGraph.tsx` (rewritten), `components/profile/YouParts.tsx` (rewritten)
- **Data:** `data/boards.ts`, `buzz.ts`, `drift.ts`, `interests.ts`, `media.ts`, `users.ts`
- **Graph:** `graph/agent.ts`, `config.ts`, `demo.ts`, `graph.ts`, `relevance.ts`, `surfaces.ts`
- **Hooks, store, types:** `hooks/useGraph.ts`, `store/useChimp.ts`, `types/models.ts`
- **Docs:** `README.md`, `BUILD_NOTES.md`

**Safe to delete by hand:**

- `src/components/happening/ChimpMark.tsx`
- `src/components/pulse/*`
- the `pulse` / `stories` / `moves` redirect stubs, once old links don't matter

## Known limitations

- **Photos** are hot-linked from Unsplash, so they need a network connection. The new Films and Science photo IDs were checked to resolve, but their subjects weren't visually verified here.
- **Video** is a still preview; "watching" means dwelling in the viewer.
- **The Happening graph** is seeded for WollyMc, pending onboarding. Positions are fixed; nodes animate position, links don't.
- **Board sections** beyond these modules (e.g., per-section pages) aren't built. Explore is long, but finite with seed data.
- **Lint:** `npx expo lint` wasn't run here (it needs network setup). Run it locally.
- **Not built, as agreed:** Supabase, auth, video infra, live news, payments, push, production AI, moderation.

## What to test on your iPhone 12

1. **Launch:** cold start Chimp. It should open on **Buzz**, with the tab bar still Boards · Drift · Buzz · Happening · You · After Dark.
2. **Happening layout:** Worlds cut off at both screen edges, a smooth horizontal pan, and no mascot in the middle.
3. **Happening interaction:** tap **Japan**. It grows, its links turn blue, and 4 branches slide in. Check the panel (Open / Join / Close). Tap Japan again to close.
4. **Happening isolation:** no nightlife, dating or After Dark anywhere in the graph.
5. **You:** the lavender hero with the cut-out portrait, the handwriting, the stacked Travel / Japan / Nightlife / +2 cards, WollyMc and Boston, MA. Your edited bio and photo (if set) should still be there, and no Crush count anywhere.
6. **Crush and Spark:** open Maya Tanaka's profile.
   1. Check the row reads Connect · Message · ♡ Crush · •••.
   2. Tap Crush: it becomes a Spark card with starters.
   3. Tap a starter: the chat opens pre-filled and not sent.
7. **Crush eligibility:** on Zara's profile there should be no Crush button.
8. **Living World:** open Japan Trip.
   - **Today:** masthead date, topics, cover, Buzzing, News (demo labels), Top post, Watch, Stories, From your people, Trending, "You're caught up".
   - **Explore:** keeps loading into "More from Tokyo…".
   - **People:** the member list.
9. **Watching:** in Drift, stay on the Ninenzaka video for 2 s, go back and reopen Japan Trip. Watch should say "Moved up".
10. **Demo:** run it (Graph Debug → Run all) and check each surface against the table above.
11. **Migration:** don't reset before testing. Your Phase 4 joins, saves, likes, dislikes, chats and profile edits should all still be there.

---

# Chimp build notes — prototype v0.4 — Phase 4 surface architecture

24 Sep 2026 · Code in `C:\Users\AI Admin\Documents\Chimp` · Expo SDK 57, Expo Router, TypeScript, Expo Go only (no new native packages).

Chimp is reorganised around **Worlds** (Boards). The visual language and the Phase 3 graph engine are kept. This phase adds surfaces on top of them and maps every Phase 3 behaviour onto those surfaces.

## New navigation

**Boards · Drift · Buzz · Happening · You · After Dark**

| Tab | Role |
|---|---|
| Boards | Magazine rack of Worlds. Joined / Discover (with reasons) / Saved, graph-ranked. |
| Drift | Trending World stories, then Friends & Connections stories, then a visual feed. Vertical viewer. Video is static. |
| Buzz | Posts, Notes, memes, polls, demo news. For You / Following / Trending. Like, reply, repost, save, private dislike. |
| Happening | The Opportunity Graph. Node map, friends, "Why this matters to you" cards, Moves in your Worlds. |
| You | Approved profile design. Open To, Crush note, Open Loops, live interest graph. |
| After Dark | Own tab, 18+ gate, dark plum/magenta, own identity and content. Includes Private Plans. |

The tab bar turns dark with a magenta active icon while After Dark is open.

## Route migration

| Old route | Now |
|---|---|
| `(tabs)/pulse` | redirect → `/boards` |
| `(tabs)/stories` | redirect → `/drift` |
| `(tabs)/moves` | redirect → `/happening` |
| `/` | redirect → `/boards` |
| new | `(tabs)/drift`, `(tabs)/buzz`, `(tabs)/happening`, `(tabs)/after-dark`, `drift/[id]`, `buzz/[id]` |

- **Old tabs:** the three old tab files are hidden (`href: null`) redirect stubs, so old links still land somewhere sensible.
- **Detail routes** are unchanged.
- **Age gate:** it now returns to `/after-dark`.
- **Story viewer:** it closes back to `/drift`, and its queue never mixes After Dark and normal stories.

## Graph migration

- **Kept from Phase 3:** affinity, relevance parts, match, loops, World Delta, agent and the demo runner.
- **New entity kinds:** `buzz` and `drift`.
  - Content edges: `RELATED_TO` their World and `CREATED_BY` their author.
  - Your edges: `LIKED`, `DISLIKED` (weight −1), `SAVED`, `REPOSTED`, `CRUSH_ON`.
- **`graph/surfaces.ts`:**
  - `rankBuzz` (forYou / following / trending, where trending decays with a 10 h half-life)
  - `rankDrift` and `driftStories`
  - `buildHappening` (every item carries `why[]`) and `happeningNodes`
  - `negativeFeedback`
  - `isAfterDarkRef` and `isNightRef`
- **Board evidence** now counts Buzz and Drift likes and saves, so they lift their World.
- **World Delta** has no tab. It feeds Boards badges, the Buzz "World updates" strip, the Happening node badges and the Agent.
- **Agent baseline** now also snapshots the Buzz and Drift rankings.
- **Config (`graph/config.ts`):** new `AFFINITY.rules` for dislike −0.04, undislike +0.04, repost +0.04 and reply +0.04. New blocks: `NEGATIVE`, `SURFACE_WEIGHTS`, `TRENDING`, `HAPPENING` {minScore 30, maxItems 14, nodes 7}, and `MATCH.suggestAt` 60.

## Dislike behaviour

- **Private.** A thumbs-down on Buzz cards, with no count and no notification.
- **On the card.** It collapses to "You'll see less like this from *World*", with Undo. Like and dislike are mutually exclusive.
- **Affinity.** The item's interests move by −0.04. Undo restores them.
- **Penalty on similar Buzz and Drift:**

  | Match | Penalty |
  |---|---|
  | Same World | 6 |
  | Per shared interest | 2.5 |
  | Same author | 3 |
  | Cap | 16 |

- **Verified:** disliking the loafers poll moves it from 21.6 to 6.4, and the other style posts drop by about 5.
- **Graph Debug → Negative feedback** lists the down-weighted Worlds, interests and authors.

## After Dark isolation

- **Gate.** The 18+ confirmation sits inside the tab. After it, the tab bar goes dark. After Dark has its own identity mode and its own content pool (`data/afterDark.ts`).
- **Excluded everywhere else.** `isAfterDarkRef` (age-gated or nightlife-template Worlds) is applied to:
  - Boards (Joined, Discover, Saved)
  - Drift feed and stories
  - Buzz
  - Happening
  - World Delta release pools
  - Agent summaries
  - the story viewer queue
- **Happening is stricter.** It uses `isNightRef`, which also removes public nightlife (NYC Rooftops, Rooftop Night) and any reason or conversation starter that names them. A scripted check confirmed no leaks, including after a Spark.
- **Content rules.** Non-explicit only: no nudity, no explicit content, no payments.

## Crush / Spark and Open To

- **Open To:** friends, dating, casual, networking, collaboration, not looking, plus travel and events. "Not looking" clears dating and casual.
- **Crush card.** It shows on a profile only when both people are open to dating or casual.
- **Crush is private.** It has no effect on ranking and sends nothing. Who crushed whom is never shown.
- **Spark.** It needs a Crush on both sides. It appears on the profile, at the top of Happening and in the You Crush note.
- **Conversation starters** are generated from shared Moves, Worlds, posts and interests, with no pickup lines. A starter pre-fills the chat composer.
- **Not built:** no swipe UI and no deck.

## Demo instructions

1. **Reset:** You → ⚙ Settings → Reset demo data.
2. **Do the eight actions**, or use Graph Debug → *Run all*:
   1. Join Japan Trip.
   2. Save the Kyoto Temple Walk.
   3. Like the Ninenzaka Drift video.
   4. Like Maya's Kyoto Buzz post.
   5. Dislike the "Loafers with socks?" poll.
   6. Open the "Find a travel buddy for Japan" loop.
   7. Follow Maya Tanaka.
   8. Mark Tokyo Food Tour as Interested.
3. **Try the Spark:** on Maya Chen's profile, tap Crush. She already has one on you, so it becomes a Spark.

Scripted results (before → after):

| Metric | Result |
|---|---|
| Japan affinity | 0.45 → 0.84 |
| Japan Trip (Boards) | #5 → #1 |
| Drift top 3 | Japan (Fuji, Ninenzaka, Shibuya); Street Style drops #6 → #12 |
| Buzz For You | led by the Japan note and the Kyoto post |
| Happening | opens with "Tokyo Food Tour matches your Japan travel loop" and "Zara is into the same Tokyo plan" |
| Zara | 73 → 87% |
| Maya Tanaka | 41 → 54% |
| Agent | "Your Japan planning activity increased this week" |

## Verification

- **TypeScript:** `tsc --noEmit` is clean.
- **Migration test:** migrating a v3 store to v4 keeps profile edits, joins, saves, follows and chats. It maps Open To and adds the new fields.
- **Scenario test:** the demo results above, plus no After Dark content in Buzz, Drift or Happening.
- **Smoke test:** all 37 routes render with 0 errors in a web export, both fresh and after the demo plus 3 h simulated away.

## Changed files

**New (16):**

- **Tabs:**
  - `app/(tabs)/drift.tsx`
  - `app/(tabs)/buzz.tsx`
  - `app/(tabs)/happening.tsx`
  - `app/(tabs)/after-dark.tsx`
- **Routes:**
  - `app/drift/[id].tsx`
  - `app/buzz/[id].tsx`
- **Components:**
  - `components/buzz/BuzzCard.tsx`
  - `components/drift/DriftTile.tsx`
  - `components/happening/HappeningGraph.tsx`
  - `components/happening/ChimpMark.tsx`
  - `components/profile/YouParts.tsx`
  - `components/profile/InterestIcon.tsx`
  - `components/ui/Segmented.tsx`
- **Data:**
  - `data/buzz.ts`
  - `data/drift.ts`
- **Graph:**
  - `graph/surfaces.ts`

**Modified (36 source files, plus the two docs):**

- **Routes:**
  - `app/(tabs)/_layout.tsx`
  - `boards.tsx`
  - `you.tsx`
  - `pulse.tsx`, `stories.tsx` and `moves.tsx` (now stubs)
  - `app/_layout.tsx`
  - `index.tsx`
  - `age-gate.tsx`
  - `settings.tsx`
  - `graph-debug.tsx`
  - `board/[id].tsx`
  - `profile/[id].tsx`
  - `chat/[id].tsx`
  - `story/[id].tsx`
- **Components:**
  - `components/TabBar.tsx`
  - `afterdark/AfterDarkWorld.tsx`
  - `afterdark/NightParts.tsx`
  - `boards/BoardCard.tsx`
  - `profile/ProfileParts.tsx`
  - `stories/StoryViewer.tsx`
  - `ui/Chip.tsx`
- **Data:**
  - `data/afterDark.ts`
  - `data/users.ts`
- **Graph:**
  - `graph/agent.ts`
  - `changes.ts`
  - `config.ts`
  - `demo.ts`
  - `graph.ts`
  - `relevance.ts`
- **Hooks, services, store, types, utils:**
  - `hooks/useGraph.ts`
  - `services/recommender.ts`
  - `services/repository.ts`
  - `store/useChimp.ts` (store version 4)
  - `types/models.ts`
  - `utils/links.ts`
- **Docs:**
  - `README.md`
  - `BUILD_NOTES.md`

**Safe to delete by hand** (no longer imported):

- `src/components/pulse/*`
- the three redirect stubs, once old deep links don't matter

## Known limitations

- **Photos** are hot-linked from Unsplash and need a network connection.
- **Video** is a still preview with a duration badge.
- **Content is seeded.** Replies, reposts and votes are local only.
- **News cards** are demo fixtures (`news.demo: true`, source "Demo source"), labelled as not live.
- **Board sections** (Today / Top Posts / News / Buzz / Watch / Stories / People / Explore) are modelled and served by `repo.world()`. Board detail only renders Posts plus the Watch and Buzz rows so far.
- **Lint:** `npx expo lint` wasn't run here. Run it locally.
- **Not built, as agreed:**
  - Supabase
  - production auth
  - media upload
  - video CDN
  - live news
  - production AI
  - creator payments
  - explicit content
  - full dating
  - swipe deck
  - push
  - Board creation UI
  - moderation
  - app store release

## What to test on your iPhone 12

1. **Tab bar:** all six labels fit on one line, and every tab opens.
2. **After Dark:** the tab shows the 18+ gate once. After confirming, the screen and tab bar go dark plum/magenta. Switching back restores the light bar.
3. **Boards:** the 2-column magazine cards aren't clipped. Joined / Discover / Saved switch correctly, and Discover cards show reasons.
4. **Drift:** stories bubbles open the story viewer. Tiles open the vertical viewer, and paging, like and save work. The "From the World" link opens the Board.
5. **Buzz:** For You / Following / Trending switch. Tap the thumbs-down and the card collapses with Undo, and there's no count anywhere. Replies post in the thread. The news cards say "demo".
6. **Happening:** the node map labels stay on screen, and the Chimp mark opens the Agent. Every card has "why" lines. No nightlife or After Dark content appears.
7. **You:** the profile card, mini cards, Agent, People You Should Meet and Open To all render. "Not looking" turns off dating and casual.
8. **Crush → Spark:** on Maya Chen's profile, tap Crush. It becomes a Spark, a Spark card appears in Happening, and tapping a starter pre-fills the chat.
9. **Migration:** open the app without resetting. Your Phase 3 joins, saves, profile edits and chats should still be there.
10. **Demo:** run the eight steps, or Graph Debug → Run all, and check the before → now scorecard.
