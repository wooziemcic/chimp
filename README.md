# Chimp

> “What changed in the world that matters specifically to me?”

Chimp is a personal **possibility graph**: Worlds (Boards), People, Buzz, Happening and Moves joined around one private model of what matters to you.

Since Phase 6A, a real person can **sign up** (since Phase 6D: **Continue with Email** and a 6-digit code), set up a profile and create things: Buzz, Drift, Stories and new Worlds. Accounts are backed by **Supabase** (Auth, Postgres, Storage, and since Phase 6B, Realtime for chat). The original seeded world is still there as the **Demo account**, for development and the scripted demo.

- **Stack:** Expo SDK 57, Expo Router, React Native 0.86, TypeScript, zustand, AsyncStorage, Supabase
- **Target:** iPhone 12 (390 × 844 pt) in **Expo Go**
- **Native modules:** only the ones Expo Go already bundles (no development build needed)

---

## Run it on your iPhone 12 (Windows + Expo Go)

### 1. One-time setup

- Install **Node.js 20 LTS or 22 LTS** from nodejs.org. Check it in PowerShell with `node -v`.
- On the iPhone, install **Expo Go** from the App Store. It must support SDK 57, so update it if it's already installed.
- Put the PC and the iPhone on the **same Wi-Fi network**.

### 2. Install and start

```powershell
cd "C:\Users\AI Admin\Documents\Chimp"
npm install
npx expo start
```

When Metro starts, a QR code appears in the terminal.

**Real accounts** need a Supabase project and a `.env.local` file. See [Phase 6A → Supabase setup](#supabase-setup-one-time) below. Without it, the app opens on Welcome and you can use **"Developer: enter the Demo account"**. After adding or changing `.env.local`, always start with `npx expo start -c`.

### 3. Open on the iPhone

Open the iPhone **Camera** app, point it at the QR code, and tap the **“Open in Expo Go”** banner. You can also open Expo Go and pick the project under “Development servers”.

The first bundle takes 20–60 seconds. Later reloads are fast. Shake the phone to open the developer menu (Reload, performance monitor).

### If the phone can't connect (common on Windows)

1. **Windows Firewall.** When Windows asks, allow **Node.js JavaScript Runtime** on **Private networks**. If you already dismissed the prompt, go to Windows Security → Firewall & network protection → Allow an app through firewall, and tick Node.js for Private.
2. **Network profile.** Go to Settings → Network & Internet → Wi-Fi → your network, and set it to **Private**, not Public.
3. **Tunnel fallback.** This works across networks and firewalls, but it's slower:

   ```powershell
   npx expo start --tunnel
   ```

   The first time, accept the prompt to install `@expo/ngrok`.
4. **Stale cache.** `npx expo start -c`

### Useful commands

```powershell
npm run typecheck     # TypeScript, no emit
npx expo start -c     # start with a clean bundler cache
```

In the **Demo account**, **You → ⚙ Settings → Reset demo data** restores the seeded state. **Settings → Graph Debug** shows why everything is ranked the way it is. From a real account, **Settings → Developer → Enter Demo Account** switches to the demo.

---

## What's in this build

Five tabs: **Boards · Buzz · Happening · You · After Dark**. Buzz has four sub-tabs: **For You · Following · Trending · Drift** (Phase 6C; Drift is the full-screen vertical media mode). Chimp opens into **Buzz**, after Welcome and sign-in (Phase 6A). See the Phase sections below for details.

| Area | What works |
|---|---|
| **Accounts** (6A; email since 6D) | Welcome → Continue with Email → 6-digit code → profile (photo, name, @username, city, bio) → phrase + emoji → 3–8 interests → Open To → Buzz. A new account starts at zero, with no seeded people. |
| **Create** (6A–6C) | Buzz (one "What's buzzing?" box with optional photos, a **short video** (6C), poll and World), Photos in a World (1–6 photos), Story (you, or you + a World), new Worlds (cover, category, public or private). Comments on Buzz and Drift. |
| **Boards** | A two-column magazine rack of Worlds: Joined / Discover (each with a reason) / Saved, ranked by the graph. Each Board is a **Living World**: a personalised **Today** edition, an **Explore** stream and **People**. |
| **Japan Trip** | Hero, members, Join/Joined, then Today (cover, Buzzing, News, Top post, Watch, Stories, From your people, Trending), Explore and People. Like, save, vote and comment all work. |
| **Messages** (6B; groups since the messaging patch) | Real-time 1:1 and **group** chats: Chats / Requests, unread badges, optimistic send with retry, photos. Long-press for reactions (with **⚡ Same Brain**), Reply, **Open Loops**, Copy and Delete. ✨ **Mutual Ping** (private until it matches). A **Chemistry** strip on groups. |
| **Buzz** | Posts, Notes, photo and video posts (caption under the media), polls and demo-labelled news cards. A World is optional ("Just Buzz"). For You (ranked) · Following (newest) · Trending (most liked) · **Drift** (full-screen vertical photos and clips). For You / Following / Trending. Like, reply, repost, save and a private **dislike**. |
| **Happening** | The Opportunity Graph as a **horizontal interest graph** you pan left and right: Worlds, sub-Worlds, people and Moves, a panel that says why each node is there, then Friends & Connections stories, **Live across your graph** (what's moving, from real events) and the few things that matter most. Since 6C the graph is **endless**, and there's no media feed here (that's Buzz → Drift). |
| **You** | The approved creative hero (cut-out portrait, “Good people, better plans”, stacked interest moments), then Open To / Sparks, Saved Boards / Your Boards, Open Loops, Your Agent, People You Should Meet, Open To, Connections / Matches and your live interest graph. |
| **After Dark** | Its own tab behind an 18+ gate. The screen and tab bar go dark plum/magenta. Confessions, Nightlife, Chemistry, Discreet and Private Plans. Non-explicit by design. |
| **Story viewer** | Auto-play with segmented progress, tap next/previous, hold to pause, pinch to zoom, swipe down to close. |
| **People / Agent / Loops** | Every recommendation shows its reason. Open Loops link to people, Boards and Moves that could close them. |
| **Identity** | Contextual identity (public, verified pseudonym, anonymous) per context. |
| **Re-entry** | Leave the app for 10+ minutes and the world moves on: changes are released and badges update. |

---

## Architecture

```
src/
  app/                    Expo Router routes (screens only)
    index.tsx             the gate: Welcome, the next onboarding step, or Buzz
    (auth)/               welcome · email · verify · profile-setup · phrase · interests · open-to (phone = redirect)
    (tabs)/               boards · buzz · happening · you · after-dark   (opens on buzz)
                          (drift · pulse · stories · moves are redirect stubs)
    create/               index · buzz · drift · story · world   (modals)
    board/[id]  buzz/[id]  drift/[id]  move/[id]  profile/[id]  story/[id]  route/[id]
    chat/[id]  comments/[postId]  after-dark/[section]
    messages  people  agent  loops  settings  search  delta  age-gate  edit-profile  new-chat
  components/
    ui/                   Text, Img, Tap, Avatar, AvatarStack, Chip, IconButton, PageHeader, misc (SectionHeader, StatItem, FreshBadge, MatchRing, EmptyState…)
    pulse/                legacy (unused since Phase 4, safe to delete)
    buzz/  drift/  happening/   BuzzCard · DriftTile · HappeningGraph, FeedTile, ChimpMark
    media/                MediaViewer (global zoom/pan/swipe modal, not a route), ChimpVideo (expo-video)
    drift/                DriftPager (Buzz → Drift), DriftTile
    chat/                 RealChat (Supabase Realtime), RelationshipCard
    boards/               BoardHero, BoardTabs, BoardCard, PostModules (Photo, Poll, Route, Place…)
    stories/              StoryBubble, StoryViewer (gestures)
    moves/                MoveCard
    profile/              ProfileHero, PersonRow, YouCards (BoardStack, OpenLoops, Agent, MatchCard)
    afterdark/            AfterDarkWorld, NightCard, ThreadCard
    auth/                 AuthUI (buttons, email field, keyboard-safe OTP boxes), ChimpWorld (illustration), Onboarding parts
    create/               CreateButton, CreateParts (Composer, WorldPicker, PhotoPicker)
    TabBar.tsx            floating custom tab bar (turns dark in After Dark)
  data/                   seeded mock data (Demo) + media catalogue + worldCatalog (the 14 Chimp Worlds)
  lib/supabase.ts         the Supabase client (public env vars only)
  services/
    dataset.ts            the ACTIVE dataset: DEMO fixtures or REAL account rows
    repository.ts         the only read path to content (reads the active dataset)
    create.ts             create Buzz / Drift / Story / World (REAL uploads, DEMO keeps locally)
    backend/              auth · content (load, create, sync) · chat · media (compress + upload) · mappers · realData
    recommender.ts        deterministic, explainable ranking (no engagement maximising)
  store/useChimp.ts       persisted private graph: joins, saves, votes, follows, connections,
                          seen state, World Delta, Open Loops, interest affinity, identity, chats
                          (one bucket per account: chimp-store = Demo, chimp-store:real:{uid})
  store/useSession.ts     boot, sign in, onboarding progress, developer flag, delete account, and one serialized transition() for enter REAL / Demo and sign out
  store/useChat.ts        live chat state (not persisted; Supabase is the source of truth)
  store/useMediaViewer.ts the one open media viewer
supabase/migrations/      0001_phase6a.sql: schema, RLS, storage bucket, Chimp World seed
                          0002_phase6b.sql: chat, mutual connections, blocks, Realtime
                          0003_phase6c.sql: video Buzz, 50 MB clips, real like totals
                          0004_phase6d.sql: World ownership + RLS fix, Follow/Join, roles, edit/delete, developer access, account deletion
                          0005_delete_world.sql: delete_world() (owner only), shared World teardown, Storage clean-up queue
supabase/functions/       delete-account/index.ts: deletes the caller's own account · delete-world/index.ts: deletes a World for its owner (Deno; deployed in Supabase)
  hooks/  theme/  types/  utils/
```

### Design choices worth knowing

- **Relationships are three different things.** *Following* is one-way. A *connection* is mutual. *Matches* are suggested by the system and always carry a `MatchReason`.
- **Stories always have an owner** (`owner: EntityRef` pointing to a board, person, scene or Move), which is what lets the viewer deep-link into the persistent object.
- **Contextual identity.** `Post.authorMode`, `Comment.authorMode` and `identity[context]` allow public, pseudonymous, anonymous or private presentation per context, while the private graph stays unified.
- **Personalization loop.** Every action calls `track()`, which logs an `ActivityEvent` and adjusts interest affinity. The recommender uses affinity, Open Loops and freshness. Boards, Drift, Buzz, Happening, People and the Agent reorder as you use the app.
- **Backend (Phase 6A).** Supabase is the source of truth for real accounts. `services/backend/mappers.ts` turns rows into the same types the UI always used, and `repository.ts` reads the active dataset. Store actions update the UI optimistically and write the row in the background. Screens never read seeded content from `data/` directly; only static catalogues (icons, interests, the World catalog, After Dark sections) are imported.

### Images

Photos are hot-linked from Unsplash through `src/data/media.ts`, at widths chosen for a 3× iPhone screen, and cached by `expo-image`. To use your own assets, change the URLs in that one file. Cards show a soft tint while images load, so the layout holds even without network.

### Expo Go limitations

None so far. Gestures use `react-native-gesture-handler` and `react-native-reanimated`, which Expo Go bundles. The route map is a schematic SVG instead of `react-native-maps`, to keep the setup simple; real maps also work in Expo Go and can be added when needed.

---

## Phase 2 — core experience polish

### Board theme engine (`src/theme/boardThemes.ts`)

Boards no longer carry one-off styling. Each Board has:

- `template`: `'standard'` (hero + tabs + modules, e.g. Japan Trip) or `'nightlife'` (the After Dark layout). Chimp owns this fixed set.
- `theme: BoardTheme`: `mode`, `background`, `surface`, `surfaceAlt`, `primary`, `primarySoft`, `onPrimary`, `secondary`, `text`, `mutedText`, `line`, `gradient`, `accent`.

Themes come from `createBoardTheme({ id, mode, primary, secondary?, tint?, accent? })`. The recipe derives every token and enforces contrast, so a small set of ingredients (e.g. chosen by AI later) can never produce an unreadable board or an arbitrary layout. Japan Trip uses `sakura`, After Dark uses `neonNight`, and NYC Rooftops uses `dusk` (a dark theme on the standard template). A future "Kathmandu" board is just:

```ts
theme: createBoardTheme({ id: 'kathmandu', mode: 'light', primary: '#B91C1C', secondary: '#1D4ED8' }),
template: 'standard',
```

### Profiles & matching

- `User` now supports `heroImage`, `heroCutout`, `openTo[]`, `prompts[]` and `moments[]`. `Profile` describes the full screen payload (counts, saved and owned Boards, Open Loops).
- `MatchExplanation` (`matchScore`, `matchReasons[]`, `mutualConnections[]`, `sharedBoards[]`, `sharedInterests[]`, `sharedMoves[]`, `sharedOpenTo[]`, `metThrough`) is computed deterministically by `explainMatch()` in `services/recommender.ts`. It feeds People You Should Meet, the match profile, and the chat relationship card.
- `moveRelevance()` explains why a Move is relevant to you (Open Loop → people you know → matches → joined Board → interests). Cards show the short form and Move Detail shows the full sentences.

### Local assets

The WollyMc portrait is bundled at `assets/profiles/wollymc.png` (a transparent cut-out) and `assets/profiles/wollymc-avatar.jpg` (a circular crop). To change the artwork, replace those files. `Img`/`Avatar` accept a URL or a bundled `require()`.

---

## Phase 3: the Opportunity Graph behaviour layer

Everything WollyMc does now changes the rest of the app, locally and deterministically. There is no backend, no AI API, and no randomness.

### Where it lives

| File | What it does |
|---|---|
| `src/graph/config.ts` | **Every weight in one place**: affinity nudges, relevance weights, match weights, loop steps, release rules. |
| `src/graph/graph.ts` | Typed `GraphEdge`s. Content edges (members, Board↔Board `RELATED_TO`, locations, attendees) are built once. Your edges (`JOINED`, `SAVED`, `FOLLOWS`, `VOTED`, `RSVPED`, `VIEWED`…) are **derived from the store**, so they can never drift from what the screens show. |
| `src/graph/relevance.ts` | `scoreBoard` / `scoreMove` / `scoreStory` → `{ score, reasons[], parts }`, plus `explainPerson` (live match score, reasons, shared Boards/Moves/interests, mutuals, relevant loops, relationship state). |
| `src/graph/loops.ts` | Open Loop progress and steps, derived from the graph. |
| `src/graph/changes.ts` | World Delta: conditional pool, reactions to your actions, release on return. |
| `src/graph/agent.ts` | Your Agent: *what changed / who to meet / what next / which loop to close*. |
| `src/app/graph-debug.tsx` | **Graph Debug** (Settings → Developer, dev builds only). |

### The scoring model in plain terms

- **Affinity** (0–1 per interest): view +0.01, story +0.02, like/vote +0.03, save +0.05, follow/interested +0.06, join/open loop/connect +0.08, RSVP +0.10. An object's first two interests get the full nudge; the rest get half. Undo reverses it.
- **Relevance** (0–100):

  | Signal | Share |
  |---|---|
  | Interest affinity | 35 |
  | Your relationship to it or its Board (including related Boards) | 20 |
  | Active Open Loops it serves | 20 |
  | People you know / strong matches involved | 12 |
  | Unseen changes | 5 |
  | Editorial | 8 |

  A tiny id-hash tiebreak keeps rankings stable. There are no engagement metrics.
- **Match** (30–98%): shared interests weighted by your affinity, shared Boards, shared Moves, loops they fit, mutual connections, overlapping Open To, and same city (or "lives where you're headed").
- **Reasons** are generated from the parts that produced the score, e.g. "You joined Japan Trip · You saved Kyoto Temple Walk · Zara is interested". Scores appear only in Graph Debug.

### World Delta

- **Seed changes on first launch:** five of them.
- **Reactions to your actions** are queued and appear the next time you come back: "Tokyo Food Tour now matches your Japan travel loop", "Zara Ahmed is now a strong match".
- **On return after 10+ minutes**, 1 to 3 changes are released:

  | Time away | Changes released |
  |---|---|
  | 10–30 min | 1 |
  | 30–120 min | 2 |
  | 2 h or more | 3 |

- **What gets released:** queued reactions and pool events whose conditions hold, e.g. "only if you follow Maya", "only while the Japan loop is open". Stale ones are dropped.
- **Blue dots:** the dots on Pulse and elsewhere are unseen ChangeEvents. Opening the object clears them.

### Demo path (about 5 minutes)

> Superseded by the Phase 4 demo below: Pulse, Stories and Moves are no longer tabs.

1. **Reset.** Settings → Reset demo data (or Graph Debug → Reset demo).
2. **Note the starting state.** Japan Trip is in Boards → Discover but not on top. Tokyo Food Tour is not first in Featured Moves. Zara is around 73%.
3. **Do the six actions:**
   1. Join **Japan Trip**.
   2. Save the **Kyoto Temple Walk**.
   3. Vote **Tokyo** in the poll.
   4. Follow **Maya Tanaka** (Board → People).
   5. On You → Open Loops, tap **Open** on "Find a travel buddy for Japan".
   6. Open **Tokyo Food Tour** → **Interested**.
4. **See the results:**
   - Tokyo Food Tour leads Featured, with "Japan travel loop" on its card and five generated reasons on its detail screen.
   - The Japan Trip Story takes the biggest Stories bubble.
   - Zara reaches 87% (a "Suggested match").
   - Interests on You re-order, with Japan filled.
   - The Agent says "Your Japan planning activity increased this week", and the loop shows its progress.
5. **Connect with Zara and say hi.** The travel-buddy loop reaches 95%. Mark it resolved.
6. **See World Delta.** Leave the app for 10+ minutes, or use Graph Debug → *Simulate 1 hour away*.

Graph Debug can also run the six steps for you (*Next step* / *Run all*) and shows before → now for each metric.

### Board model foundation

- `Board` now has `type` (canonical / curated / user_created / private), `ownerId`, `slug`, `visibility`, `themeId`, `relatedBoardIds`, `location?` and `canonicalParentId?`.
- Boards are assembled by `services/boardFactory.ts`. `createUserBoard()` is ready for a future creation flow and only accepts a known template and theme.
- `data/examples.ts` holds two model fixtures, not shown in the app: *Kathmandu* (canonical) and *Kathmandu Food Hunt* (user_created, parent Kathmandu).

### Storage

The persisted store was **version 3** in Phase 3 (now version 4, see below). On first launch after this update, the relationship graph resets once to the demo seed. Your photo, bio, city, Open To, identity settings, chats and comments are kept.

---

## Phase 4: surface architecture (Worlds)

Chimp is now organised around **Worlds** (Boards). Every piece of content belongs to a World and a creator, and the Opportunity Graph from Phase 3 ranks all of it. The visual language and the graph engine are unchanged. This phase adds surfaces and maps the graph onto them.

### Navigation

| Tab | Question it answers | What's there |
|---|---|---|
| **Boards** | Which Worlds am I part of? | Two-column magazine rack. Joined / Discover / Saved, ranked by the graph. Discover cards say why. |
| **Drift** | What does my world look like right now? | Stories trending in your Worlds, then Friends & Connections stories, then a visual "For you" feed (photos, video previews, carousels, memes). Tap a tile to open a vertical viewer. |
| **Buzz** | What are people saying? | Posts, Notes (~250 words), memes, polls and news cards. For You / Following / Trending. Like, reply, repost, save and **dislike**. |
| **Happening** | What matters specifically to me? | The Opportunity Graph. A node map around the Chimp mark, Friends & Connections, and cards that say **why this matters to you**. Moves now live here. |
| **You** | Who am I here? | The approved profile layout, Open To, a private Crush note, Open Loops and your live interest graph. |
| **After Dark** | (18+) | Its own tab, identity mode, theme and content. Confessions, Nightlife, Chemistry, Discreet and Private Plans. |

### Route migration

| Old | New |
|---|---|
| `/(tabs)/pulse` | redirects to `/boards` (Pulse is no longer a tab) |
| `/(tabs)/stories` | redirects to `/drift` (Stories are the top of Drift) |
| `/(tabs)/moves` | redirects to `/happening` (Moves live in Happening) |
| `/` | redirects to `/boards` |
| new | `/(tabs)/drift`, `/(tabs)/buzz`, `/(tabs)/happening`, `/(tabs)/after-dark`, `/drift/[id]`, `/buzz/[id]` |

Every existing detail route (`/board/[id]`, `/move/[id]`, `/story/[id]`, `/profile/[id]`, `/chat/[id]`, `/after-dark/[section]`, `/delta`, `/agent`, `/loops`, `/people`, `/graph-debug`…) still works. The three old tab files are one-line redirect stubs, so old deep links can't break.

### Graph migration

Everything from Phase 3 (affinity, relevance parts, loops, World Delta, agent) is kept. The new pieces:

- **New nodes and edges.** Buzz and Drift items are graph nodes with `RELATED_TO` their World and `CREATED_BY` their author. Your actions add `LIKED`, `DISLIKED` (negative), `SAVED`, `REPOSTED` and a private `CRUSH_ON`.
- **`graph/surfaces.ts`** ranks Buzz (`rankBuzz` for For You / Following / Trending), Drift (`rankDrift`, `driftStories`) and builds Happening (`buildHappening`, `happeningNodes`) with the same explainable parts as Phase 3. Weights are in `SURFACE_WEIGHTS`, `TRENDING` and `HAPPENING` in `graph/config.ts`.
- **Board evidence** now counts Buzz and Drift likes and saves inside a World, so liking Japan content lifts Japan Trip in Boards.
- **World Delta** has no tab. It feeds badges on Boards, the World-updates strip in Buzz, the Happening node counts and the Agent.

### Dislike

- A thumbs-down on any Buzz card. It is **private**: there is no public count and nobody is told.
- The card collapses to "Got it. You'll see less like this from *World*", with Undo. Like and dislike are mutually exclusive.
- It lowers the item's interests by **−0.04** (`AFFINITY.rules.dislike` in `graph/config.ts`) and adds a capped penalty to similar Buzz and Drift. Similar means same World (6), shared interests (2.5 each) or same author (3), up to 16. These values are in `NEGATIVE`.
- Graph Debug → **Negative feedback** shows exactly what is being down-weighted.

### After Dark isolation

- **Tab and gate.** After Dark is its own tab. The first open shows an 18+ confirmation, and then the screen and tab bar switch to the dark plum/magenta theme.
- **Separate content.** After Dark has its own content pool (`data/afterDark.ts`) and its own identity mode.
- **Excluded from other surfaces.** 18+ content (age-gated or nightlife Worlds) is filtered out of Boards, Drift, Buzz, Happening, the Agent, World Delta and story queues by `isAfterDarkRef`. After Dark stories never mix with normal ones in the viewer.
- **Happening is stricter.** It uses `isNightRef`, which also excludes public nightlife (NYC Rooftops, Rooftop Night) and any reason or conversation starter that names them.
- **Nothing explicit.** There is no nudity, no explicit content and no payments.

### Crush and Spark

- **Where it shows.** On a profile, a Crush card appears only when both of you are open to dating or casual.
- **Crush is private.** It changes no ranking and sends nothing. Nobody is ever told who has a crush on them.
- **Spark is mutual.** When both sides have a Crush, it becomes a Spark. The Spark shows on the profile and at the top of Happening, with a conversation starter drawn from shared context: a shared Move, World or post. Tapping a starter opens the chat with it pre-filled. The chat's Relationship card lists more starters.
- **What's not built.** There is no swipe deck and no dating flow.
- **Open To** now has friends, dating, casual, networking, collaboration and not looking (plus travel and events). "Not looking" turns off dating and casual.

### Buzz news cards

News cards are **seeded demo fixtures**. In the data they are `news.demo: true` with source "Demo source", and the card says "prototype fixture, not live news". Nothing is scraped or fetched.

### Board detail model

- `Board.sections` (Today / Top Posts / News / Buzz / Watch / Stories / People / Explore) is defined in the types.
- `repo.world(boardId)` returns everything that belongs to one World.
- Board detail already shows **Watch in X** (Drift) and **Buzz in X** rows.
- Japan Trip is unchanged.

### Demo (about 5 minutes)

1. **Reset.** You → ⚙ Settings → Reset demo data.
2. **Note the start.** Japan Trip is in Boards → Discover but not on top. Drift is led by founder and Lisbon content. Maya Tanaka is about a 41% match and Zara about 73%.
3. **Do the eight actions:**
   1. **Boards:** join **Japan Trip**.
   2. **Japan Trip → Posts:** save the **Kyoto Temple Walk**.
   3. **Drift:** like the **Ninenzaka** video.
   4. **Buzz → For You:** like Maya's Kyoto post (“the city belongs to you until 7:30am”).
   5. **Buzz:** **dislike** the “Loafers with socks?” poll (Vintage Finds).
   6. **You → Open Loops:** tap **Open** on "Find a travel buddy for Japan".
   7. Follow **Maya Tanaka** (Japan Trip → People, or her profile).
   8. **Happening → Moves**, or the Japan Trip Board: open **Tokyo Food Tour** → **Interested**.
4. **See the results:**

   | Where | What changes |
   |---|---|
   | Boards | Japan Trip is #1 in Joined. |
   | Drift | Japan leads (Fuji, Ninenzaka, Shibuya). The Street Style item drops from #6 to #12. |
   | Buzz For You | Japan notes lead. Style and vintage posts sink. |
   | Happening | Opens with "Tokyo Food Tour matches your Japan travel loop" and "Zara is into the same Tokyo plan". |
   | Matches | Zara reaches about 87%, Maya Tanaka about 54%. |
   | Agent | "Your Japan planning activity increased this week". |

5. **Try Crush → Spark.** On **Maya Chen**'s profile, tap Crush. She already has one on you, so it becomes a Spark, and a Spark card appears at the top of Happening.

Graph Debug (Settings → Graph Debug) can run the eight steps for you (*Next step* / *Run all*). It shows before → now for Boards, Drift, Buzz, Happening and matches, plus negative feedback, crushes and reasons.

### Storage

The persisted store is now **version 4**. Migration from v3 keeps everything: profile, photo, joins, saves, votes, follows, connections, chats, loops and affinity. It adds the new Buzz, Drift and Crush fields, and maps old Open To values (collaborators → collaboration, professional → networking). Stores older than v3 still get the one-time Phase 3 reset.

### Legacy files (safe to delete by hand)

Nothing imports these any more:

- `src/components/pulse/*`
- the `buildPulse` function in `src/services/recommender.ts`

The redirect stubs `src/app/(tabs)/pulse.tsx`, `stories.tsx` and `moves.tsx` are also safe to delete once you don't need old deep links.

### Known limitations

- **Photos** are hot-linked from Unsplash, so they need a network connection.
- **Video** is a still with a duration badge. There is no playback.
- **Content is seeded.** Replies, reposts and votes are local only, and there is no posting or media upload.
- **Board sections** are modelled but not yet rendered as a tab bar inside Boards.
- **Happening** is deterministic from seed data. With little activity it can be short, and that's by design.
- **`npx expo lint`** was not run in the build environment (no network for its setup). Run it locally.

---

## Phase 5: Living Worlds

Four changes, one graph. The six-tab architecture and the Phase 3/4 engine are unchanged; everything below reads from the same Opportunity Graph.

### 1. Buzz is the landing surface

- `/` redirects to **`/buzz`**, and the tabs layout sets `initialRouteName: 'buzz'`. The legacy `/pulse` also lands on Buzz.
- The tab bar order is unchanged: Boards · Drift · Buzz · Happening · You · After Dark.
- Deep links are untouched: `/board/[id]`, `/profile/[id]`, `/chat/[id]`, `/drift/[id]`, `/buzz/[id]` and the rest.
- Buzz itself is as approved: For You / Following / Trending, private dislike, "Why this is in your Buzz" on threads.

### 2. Happening: a horizontal interest graph

- **No centre object and no radial hub.** Worlds run left → right across a canvas about three screens wide, in a gentle zig-zag. The screen opens between Travel and Japan, with Films and Food cut off at the edges so you can see there's more.
- **Layout is deterministic** (`graph/happening.ts` + `data/happening.ts`). There's no physics: each World has a fixed slot.
- **What you see at once:** about 4 Worlds, 3–4 small supporting nodes and a few dots on the links.
- **What drives the nodes:**
  - Size, badge and "why" come from the graph: affinity, your evidence in the branch, dislikes, `scoreBoard` / `scoreMove` / `scoreBuzz` / `explainPerson` and World Delta.
  - A World at strength ≥ 62 shows an extra branch node, which is how Japan's sub-nodes appear as you use the app.
- **Tapping a World:**
  - It grows, its links light up and its branch opens.
  - 2–4 related nodes (sub-Worlds, people, Moves, occasionally Buzz) appear in a column to its right, and the rest of the graph slides over.
  - A small panel shows what the World is, the count ("8.4K planning"), **Why it's here**, and **Open / Join-Follow / Explore**.
  - Tap it again to close the branch.
- **Remembered branch:** the open branch is saved (`happeningFocus`). Exploring a branch for the first time is a small graph signal.
- **Isolation:** After Dark, nightlife and dating never appear here (`isNightRef` on every node).
- **Friends & Connections** is a smaller strip beneath the graph.

### 3. You: the approved hero is back

- **Hero:** `ProfileHero` leads the page again: the WollyMc cut-out on lavender, "Good people, better plans ♡", stacked moments (Travel · Japan · Nightlife · +2), the big name, Boston, MA, bio, Known For and Followers / Following / Connections / Matches.
- **Moments reorder:** they keep the approved order until an interest heats up. After the demo, Japan moves to the front and an **Into lately: Japan · Travel** line appears.
- **Below the hero:**
  - Open To (Dating · Friends · Travel…), with Sparks shown only when there are any
  - Saved Boards / Your Boards
  - Open Loops
  - Your Agent
  - People You Should Meet
  - the full Open To card
  - Connections / Matches
  - interests and prompts
- **Never shown:** Crush counts, Crushes received, or anyone secretly interested.

### 4. Crush and Spark

- **Where it appears:** on another person's profile the action row is **Connect · Message · ♡ Crush · •••**. The ••• menu holds Follow and Block.
- **Who is eligible:** Crush appears only when you are both open to dating or casual and nobody is blocked (`crushEligible`). It never appears on your own profile.
- **Crush is private.** Nothing is sent, and there's no notification and no ranking effect.
- **Spark:** Crush + Crush = **Spark**, "You and Maya have a Spark". The order is never recorded or shown. Seeded: Maya Tanaka, Maya Chen and Leah already have a Crush on you.
- **Conversation starters** come from shared context, each with its source:
  - "You disagreed on Maya's Kyoto poll"
  - "You're both into Tokyo Food Tour"
  - "You're both in Japan Trip"
  - "Maya posted in Japan Trip"

  Tapping one pre-fills the chat and never sends it.

### 5. Living Boards (a World as a digital magazine)

Board detail has three tabs: **Today · Explore · People**. Old `?tab=posts|albums|tips` links map to Today or Explore.

- **Today** is a finite edition (`graph/worlds.ts → buildEdition`):
  - **Masthead** with the date and the World's topics in *your* order.
  - **Cover / lead:** the single most relevant news item, video or post.
  - **Modules:** Buzzing, News (3–5, demo-flagged), Top post, Watch (Drift), Stories, From your people, Trending (topics and related sub-Worlds).
  - It ends with "You're caught up".
- **Explore** (`buildExplore`) is the rabbit hole. It mixes posts, Buzz, Drift, tips, photos, stories and Moves, interleaved so formats never clump. It then continues into related Worlds ("More from Tokyo…"), and loads more as you scroll.
- **Personalisation uses the existing engine.** Items use the same scorers as Buzz and Drift, plus a nudge from the World's topics you care about.
  - Module order = an editorial base + your evidence *inside this World* + a little of the best item's relevance.
  - Watching the World's Drift lifts Watch, saving its posts lifts Top post, and following its people lifts From your people. The module shows "Moved up · because…".
  - The data is the same for everyone. Topic order is where the difference shows: WollyMc sees Tokyo · Food · Kyoto · Travel planning first, while someone into style and art would see Fashion · Culture first.
- **News stays demo:** `news.demo: true`, source "Demo source", labelled "prototype fixtures, not live reporting".
- **New seed content:**
  - Japan: 3 more demo news items, a meme, a Tokyo food post, Maya's Kyoto poll and a food-hall video.
  - Two new Worlds, **Indie Film** (Films) and **Space** (Science), each with Buzz and Drift.

### Graph changes

- **New interests:** `i_film` (0.40) and `i_science` (0.20).
- **New activities:**
  - `watch` (+0.03): the Drift viewer counts an item as watched after 1.5 s on screen, once per item.
  - `explore` (+0.03): the first time you open a Happening branch.
- **Watched Drift** is also World evidence ("You watched Japan Trip in Drift").
- **New state:** `driftViews`, `boardVisits`, `exploredNodes`, `happeningFocus` and `buzzVotes` are part of `GraphState`, so contexts memoise on them.
- **New code:**
  - `scorePost` joins `scoreBuzz` and `scoreDrift` in `graph/surfaces.ts`.
  - `graph/worlds.ts` holds the Today edition and Explore.
  - `graph/happening.ts` builds the interest graph.
  - `EDITION` and `HAPPENING_GRAPH` weights live in `graph/config.ts`.
- **Starters:** `MatchExplanation.openers` carries `{ context, draft }`. `starters` (drafts only) is kept for compatibility.
- **Agent baseline** also snapshots Japan Trip's Today order and the Happening World strengths, so Graph Debug can show before → now.

### Phase 5 demo (about 5 minutes)

1. **Reset:** You → ⚙ Settings → Reset demo data.
2. **Note the start:**
   - Japan Trip is about #5 in Boards.
   - Its Today order reads Buzzing › News › Top post › Watch.
   - In Happening, Japan is a mid-size node; Founders and Travel are bigger.
   - Maya Tanaka is about a 44% match.
3. **Do the seven actions**, or Settings → Graph Debug → *Run all*:
   1. **Boards:** open **Japan Trip**.
   2. **Drift:** open the **Ninenzaka** video and stay on it for a couple of seconds.
   3. **Buzz:** like Maya's Kyoto post ("the city belongs to you until 7:30am").
   4. **Japan Trip → Explore:** save the **Kyoto Temple Walk**.
   5. **Happening:** tap **Japan** to open its branch.
   6. Follow **Maya Tanaka** (her profile, ••• → Follow).
   7. **Buzz:** dislike Lena's "Same fit, different city" Style post.
4. **See the results:**

   | Where | What changes |
   |---|---|
   | Affinity | Japan 0.45 → 0.66 · Travel 0.50 → 0.62 · Food 0.42 → 0.54 · Style 0.15 → 0.11 |
   | Boards | Japan Trip #5 → #3 |
   | Japan Trip Today | Buzzing › Top post › Watch › News…, with "Moved up" notes on Top post, Watch and From your people |
   | Drift | the Japan video climbs into the top 4 |
   | Buzz | the Kyoto post goes from #12 to #3 and Maya's Kyoto poll joins the top 4; the Style post drops from #8 to #23 |
   | Happening | Japan goes from strength 45 (#6) to 82 (#2) and grows; its branch shows Japan Trip, Tokyo, Tokyo Food Tour and Maya |
   | You | the Japan moment leads, with "Into lately: Japan · Travel" |
   | Agent | "Your Japan planning activity increased this week" |

5. **Spark:** on Maya Tanaka's profile, tap **♡ Crush**. It becomes "You and Maya have a Spark", with starters. Vote in her Kyoto poll first to get the "You disagreed…" starter.

Graph Debug adds the following. It still has negative feedback, relationships, loops and World Delta.

- the Japan Trip **Today module ranking** (base + boost, lead, topics)
- **Happening node strength**, links and the open branch
- **Crush / Spark / eligibility**
- Drift watched and Worlds visited

### Storage

The persisted store is now **version 5**. Nothing is reset:

- Migrating from v4 keeps profile, joins, saves, votes, follows, connections, chats, loops, Buzz/Drift state, crushes and affinity.
- It adds `driftViews`, `boardVisits`, `exploredNodes` and `happeningFocus`.
- It seeds affinity only for interests that didn't exist yet (Films, Science).
- Stores older than v3 still get the one-time Phase 3 reset.

### Known limitations (Phase 5)

- **Photos** are still hot-linked from Unsplash. The new Films and Science images are new Unsplash IDs, checked to resolve.
- **Video** is a still preview. "Watching" is time on screen in the viewer.
- **The Happening graph** is seeded for WollyMc (onboarding will choose interests later). Branch positions are fixed, and links don't animate when a branch opens.
- **The Today edition order is frozen** while you read, and refreshes on your next visit.
- **Explore** ends once this World and its related Worlds run out of seed content.
- **Legacy files:** `components/happening/ChimpMark.tsx` is no longer used, joining `components/pulse/*` as safe to delete.

---

## Phase 6A: Accounts & Creation

The full write-up is in `BUILD_NOTES.md` (prototype v0.6A). In short:

### Two account modes

- **REAL:** you, signed in (with email since Phase 6D). There are **no dummy people** anywhere: no followers, connections, matches, chats, Crushes or Sparks until real ones happen. Your world is the 14 Chimp Worlds plus what real people create. Empty screens say so honestly.
- **DEMO:** the WollyMc fixture world, for development, Graph Debug and the scripted Phase 5 demo. Since Phase 6D it's only for developer accounts: **Settings → Developer → Enter Demo Account** (or Welcome → "Explore the Demo account" on a build with no backend configured).

Each mode keeps its own on-device store, so they never mix.

### Supabase setup (one time)

1. Create a project at supabase.com.
2. **SQL Editor:** paste all of `supabase/migrations/0001_phase6a.sql`, then **Run**. This creates the tables, RLS policies, the `media` storage bucket and the Chimp Worlds. Then do the same, in order, with `supabase/migrations/0002_phase6b.sql` (Phase 6B: chat, connections, blocks, Realtime) and `supabase/migrations/0003_phase6c.sql` (Phase 6C: short video, real like totals). Running any of them twice is harmless.
3. **Authentication:** since Phase 6D, sign-in is by **email code**. Follow "Phase 6D → One-time setup" below (email provider, code templates, SMTP, the delete-account function). The old phone/SMS setup is no longer used.
4. **Project Settings → API:** copy the Project URL and the **publishable** (anon) key. Never put the `service_role` / secret key in the app.
5. Copy `.env.example` to `.env.local` and fill it in:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
   ```

6. Run `npm install`, then `npx expo start -c`. The `-c` matters: Metro caches env values.

### Developer test numbers (retired in Phase 6D)

Phone sign-in and the +1 555-555-0101 … 0105 test numbers are gone. `src/config/testAuth.ts` and `EXPO_PUBLIC_ENABLE_TEST_AUTH` are no longer used; delete them from your copy.

### What a new account does

1. **Continue with Email** (since Phase 6D; there's no separate Sign Up / Sign In).
2. Enter your email.
3. Enter the 6-digit code from the email (iOS offers it above the keyboard).
4. **Make it yours:** a photo from Camera or Library, with framing; a name; an @username (checked live); city and bio.
5. **Your phrase:** about four words, max 40 characters, plus an emoji from a curated set or "More", with a live preview.
6. **What you're into:** 3–8 Worlds. This seeds your graph and Happening.
7. **Open to:** Dating and Casual are opt-in.
8. Enter Chimp, which opens **Buzz**.

### Creating

- **Where:** the blue **+** in Buzz, Drift and Boards; "What's buzzing?"; "Your story"; and **Post here / Add photos / Add to Story** on any World.
- **Images** are resized and compressed on the phone before upload.
- **New Worlds** get their theme from their category. A "Niagara Falls Trip" World is just a Travel World you create.

### Adaptive You hero

- **Uploaded photos** use a framed layout that works with any photo:
  - a rounded, tilted portrait card, positioned by your framing choice;
  - a blurred extension of the same photo behind it;
  - the phrase fitted beside the card, never over the photo.
- **The cut-out look** is kept for the Demo fixture.

### Crush fix

- Crush still needs **both** people open to Dating or Casual. Eligibility wasn't relaxed.
- When it's hidden only because *your* Open To doesn't include Dating or Casual, the profile now says so.
- Graph Debug → Account lists each person's eligibility with the reason.

### Known limitations (6A)

- **Sign-in:** phone/SMS in 6A; replaced by email codes in 6D.
- **Real people:**
  - Connection requests and follows are stored, but accepting a request is Phase 6B.
  - Chat with real people stays on your device.
  - Public like counts aren't aggregated yet.
- **Video:** there's no video yet, only photos.
- **Loading:** no realtime; pull to refresh on Buzz.
- **Demo-only features:** Moves, suggested Open Loops and the After Dark threads.

Most of these 6A limitations are addressed in Phase 6B below.

---

## Phase 6B: Niagara alpha stabilization

The full write-up, with the test list, is in `BUILD_NOTES.md` (prototype v0.6B). In short:

### One-time setup

- In Supabase → SQL Editor, run `supabase/migrations/0002_phase6b.sql` (after 0001; safe to run again).
- There are no new packages, no new `.env` variables and no store reset. Restart with `npx expo start -c`.

### What changed

- **Account switching is safe.**
  - Entering Demo, leaving Demo, signing in and signing out all go through one serialized `transition()` in `useSession`.
  - During a transition the app screens are unmounted and a neutral empty dataset is set before the store bucket swaps. This fixes the `Cannot read property 'id' of undefined` crash in `scoreBoard`.
  - The graph also skips missing Worlds and Moves instead of asserting.
- **Five tabs:** Boards · Buzz · Happening · You · After Dark. Buzz is still the landing tab.
  - Drift's stories and visual feed moved into **Happening**, in this order: graph → Friends & Connections → Why this matters → For you. Every tile gives its reason.
  - Old Drift links redirect to Happening.
- **Buzz without a World.**
  - The composer is one "What's buzzing?" box with optional Camera / Photos / Poll / World. "Just Buzz" posts need no World, and their interests are inferred from the text.
  - Captions sit under photos and are never painted over them.
- **One media viewer:** a global modal with pinch and double-tap zoom, pan, swipe between photos, and swipe down or ✕ to close. It never stacks screens.
- **Replies and comments are optimistic,** with rollback on failure and human timestamps (Just now · 5m · 2h · Yesterday · Sep 24).
- **Happening graph lanes:** each World owns a collision-free lane, and scrolling snaps to lane edges.
- **Real relationships:**
  - Connect → request → Accept is mutual.
  - Blocks are stored server-side.
  - Worlds never invent members.
- **Real-time chat** (REAL accounts only):
  - Screens: You → **Messages** (Chats / Requests, unread badges) and `/chat/[person]`.
  - Data: `conversations` / `conversation_members` / `messages` with members-only RLS, delivered over Supabase Realtime. There's no polling.
  - Message Requests for people you aren't connected with.
  - A one-way Crush is never revealed.
  - The Demo account keeps its simulated chats.

### Verified vs. still to test

- **Verified here:**
  - Postgres chat suite 35/35.
  - Web runs against a mocked Supabase with a mocked Realtime server: transitions, the REAL flow (34/34) and multi-user chat (38/38).
- **Still to test:** the real Supabase Realtime service and Expo Go on an iPhone. Run the two-phone Niagara test in `BUILD_NOTES.md`.

---

## Phase 6C: Trip Demo Candidate

This is the last structural pass of Phase 6. The full write-up and the iPhone test list are in `BUILD_NOTES.md` (prototype v0.6C).

### One-time setup

1. In Supabase → SQL Editor, run `supabase/migrations/0003_phase6c.sql` (after 0001 and 0002; it's safe to run again).
2. Run `npm install`. It adds **expo-video**, which Expo Go already bundles, so there's no custom build.
3. Restart with `npx expo start -c`.

There are no `.env` changes and no store reset.

### What changed

- **Buzz sub-tabs:** For You · Following · Trending · **Drift**.
  - For You is ranked, and your own posts from the last 30 minutes lead, newest first.
  - Following is newest first.
  - Trending is real like totals, then newest.
  - Drift is full-screen vertical photos and clips: only the visible clip plays, starting muted. It shows creator, caption and reason, and a World chip only when the item is in a World.
- **Short video:**
  - Pick a clip of up to 60 s (re-encoded on iOS); limit 50 MB.
  - A poster frame is made on the phone; the upload shows progress.
  - A failed upload keeps your clip and never leaves a phantom post; retry reuses finished uploads.
  - Clips play in the global viewer.
  - Worlds have **Add video**.
- **Fresh posts in order.** The grid no longer lets an older full-width card jump ahead of a newer half-width one.
- **World covers:**
  - One canonical cover (card = hero), uploaded to `boards/{id}/`, owner-only.
  - Replace it any time from the camera button on the hero; it shows everywhere at once.
  - "0 ideas" is now the real post count.
- **Happening:**
  - The graph is **endless**: copies of the head and tail lanes plus seamless recentering, while each World still exists once.
  - Stories, then **Live across your graph** (real activity).
  - There's no media feed any more.
- **Fast launch:**
  - No transition screen at launch.
  - This account's last load is cached on the phone and shown at once, then refreshed.
  - The load is 2 parallel waves instead of about 6 sequential ones.
  - Chat Realtime starts after Buzz has painted.
  - Development logs show `[chimp:startup]` timings.
- **Adaptive layouts:**
  - Everything sizes from the measured width and safe areas (checked at 390, 402 and 430 pt).
  - The Connections / Matches tiles put the number and the word on separate lines.
  - Profile actions: Connect · Message · ••• on one row, Crush on its own.

### Verified vs. still to test

- **Verified here:**
  - Postgres: 0003 suite 18/18; chat 35/35; 6A suites unchanged.
  - Node: 56/56.
  - Web at three iPhone sizes against a mocked Supabase: 69/69.
  - Earlier suites: REAL flow, account switching, chat 38/38, Demo sweep with 0 errors.
- **Still to test:** the real Supabase project, Expo Go on iPhones (H.264 playback, Dynamic Type, safe areas), and the two-phone video and chat tests in `BUILD_NOTES.md`.

---

## Phase 6D: Identity, Ownership & Control

The last Phase 6 patch before TestFlight. The full write-up, the data policy, the verification list and the iPhone test script are in `BUILD_NOTES.md` (prototype v0.6D).

### One-time setup

1. **SQL:** Supabase → SQL Editor → run `supabase/migrations/0004_phase6d.sql`. Run it after 0001–0003; it's safe to run again.
2. **Edge Function:** Supabase → Edge Functions → Deploy a new function → Via Editor → name it `delete-account` → paste `supabase/functions/delete-account/index.ts` → Deploy. There's no secret to add: Supabase provides the service key to the function. It never goes in the app.
3. **Email sign-in:** Authentication → Sign In / Providers → **Email**: enable it and set the Email OTP expiration (for example 10 minutes).
4. **Code templates:** Authentication → Emails. In **Magic Link** and **Confirm signup**, show `{{ .Token }}` (the 6-digit code).
5. **SMTP:** Supabase's built-in sender only reaches your project team, about 2 emails an hour. Add custom SMTP (Resend, Postmark, SendGrid, SES…) before friends sign up.
6. **Clean up:**
   - Delete `src/config/testAuth.ts` and the `EXPO_PUBLIC_ENABLE_TEST_AUTH` line in `.env.local`.
   - You can switch off the Phone provider.
7. **Delete a World (final patch 6D.2):**
   - Run `supabase/migrations/0005_delete_world.sql` after 0004.
   - Deploy a second Edge Function, `delete-world` (from `supabase/functions/delete-world/index.ts`).
   - Re-deploy `delete-account` with its updated file.
8. **Restart:** `npx expo start -c`. There are no new packages and no store reset.

### What changed

- **One sign-in path:**
  - **Continue with Email** → 6-digit code → Buzz (finished profile) or onboarding (new or unfinished).
  - Sessions persist, so you verify once per phone.
  - Nobody skips the code, the developer included.
- **Keyboard-safe code screen:**
  - Measured keyboard height (React Native keyboard events, Expo Go).
  - Compact top-aligned layout; Verify right under the boxes.
  - Boxes sized from the screen width.
  - Paste and iOS code autofill work.
- **Delete account** (Settings):
  - Explains what's deleted, shows your Worlds (delete or hand on), needs DELETE typed.
  - Done by the `delete-account` Edge Function, which can only delete the signed-in caller.
  - The email and @username become free; signing up again creates a new account.
- **Developer access** is by the verified email `aayushmallik.contact@gmail.com`, decided on the server (`my_access()`), so it survives delete + re-create. Developer tools and Demo are hidden from everyone else.
- **Worlds:**
  - **Create World works on the real project.** The "row-level security" error came from `INSERT … RETURNING` being checked against a read policy that couldn't see the new row.
  - The owner is set by the server.
  - "Created by" provenance.
  - Private / Connections / Public.
  - Roles owner · admin · member.
  - **Follow ≠ Join**: a person's World is joined by request + approval.
  - Real member and follower counts.
- **Your posts:**
  - ••• → **Edit** within 1 hour (server clock) or **Delete** any time.
  - An "Edited" label everywhere.
  - Deleting removes replies, likes and files too.
  - Replies and comments work the same way.
- **Following** never shows your own posts, and you can't follow yourself.
- **Delete a World (6D.2):**
  - Only the owner sees ••• → **Delete World**, and the database checks it's them. There's no direct row delete from the app.
  - The World's memberships, followers, requests, Drift, Stories, cover and files go with it.
  - Buzz in a Public World stays as its authors' posts; Buzz in a Connections/Private World is deleted.
  - It disappears from every screen at once; another phone's cached copy shows "World not found".

### Verified vs. still to test

- **Tested locally:**
  - tsc and ESLint clean.
  - Postgres: 0004 suite 62/62; 0003, chat and 6A suites re-run on the 0004 database.
  - Edge Function in a real Deno runtime against a mocked API.
  - Web against a mocked Supabase: 6D suite 72/72 (auth + keyboard at iPhone 12 / 15 Pro Max / 17 sizes).
  - Regressions: 6C 69/69, chat 38/38, REAL smoke, account cycles, Demo sweep, Node 56/56.
- **Must test on the real Supabase project and an iPhone:**
  - the SQL
  - the deployed function
  - the email templates and SMTP
  - the real keyboard, autofill and Larger Text
  - two-account World approval
  - delete + re-create with the same email

The list is in `BUILD_NOTES.md`.

## Final pre-TestFlight messaging patch

Group chats, reactions + Same Brain, Mutual Ping, Open Loops and Group Chemistry. The full write-up, the retention policy, the verification list and the 3-phone test script are in `BUILD_NOTES.md` (top section).

### One-time setup

1. **SQL:** Supabase → SQL Editor → run `supabase/migrations/0006_messaging_chemistry.sql` after 0005. It's safe to run again. If you ever re-run 0002, 0004 or 0005, run 0006 again afterwards.
2. **Package:** `npx expo install expo-clipboard` (for Copy; it's in Expo Go).
3. **Restart:** `npx expo start -c`. No Edge Function changes.

### What changed

- **Group chats:**
  - Messages → 👥 New group (you + 2 or more) → name → optional photo.
  - Group info: members and roles, shared Worlds, Open Loops, leave.
  - Owner: rename, photo, add/remove, admins, delete. Admins: rename, photo, add, remove members.
  - Members only, enforced by the database.
- **Reactions + ⚡ Same Brain:**
  - Long-press → ❤️ 😂 🔥 👍 😮 😭 with real counts.
  - Same Brain: 2 people within 30 s (1:1) or 3+ within 90 s (group). Decided once, on the server.
- **Mutual Ping:**
  - Free tonight, Food?, Hang out, Call?, Need advice, Thinking about you, Custom.
  - Nobody can see it until it matches (1:1: both of you; group: 3+ compatible), within 24 h.
- **Open Loops** from any message: date, place, resolve, and Create World (Private, you own it, no one auto-added).
- **Group Chemistry:** deterministic facts (active today, consensus, Same Brain, open loops, revealed Pings, shared Worlds).
- **Account deletion:**
  - 1:1 chats are deleted as before.
  - Groups survive: the person is removed, ownership passes on, and their group messages are deleted.
- **Security:**
  - Messages can now only be unsent (not rewritten or moved).
  - Realtime DELETE events no longer reveal who was in which chat.

