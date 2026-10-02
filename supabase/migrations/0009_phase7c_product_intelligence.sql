-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 7C · Product intelligence, push notifications, intents
--
-- Run AFTER 0008 (it checks). Idempotent: safe to run twice. Never re-run
-- 0001–0008 after it. RLS stays on everywhere; nothing is widened; no
-- `with check (true)` anywhere.
--
--   1. product_events        server-timestamped product analytics. Written
--                            only through log_product_events() (validated,
--                            allow-listed, rate-limited). Nobody can read it
--                            through the API. Never message bodies, OTPs,
--                            tokens, media URLs, report text or a private
--                            Crush target.
--   2. push_tokens           one row per device (Expo push token). Your own
--                            rows only; written only through
--                            register_push_token() / unregister_push_token().
--   3. notification_prefs    Messages · Connections · After Dark.
--   4. push_outbox           what to notify, filled by triggers on messages
--                            and user_events (never by a phone). One row per
--                            message per recipient (unique dedupe key); a
--                            burst in one chat is coalesced. Server only: the
--                            `push` Edge Function claims, sends through Expo
--                            → APNs, records tickets / receipts and removes
--                            dead tokens. A client cannot send a push.
--   5. set_follow / set_crush idempotent Follow and Crush intents.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  if not exists (select 1 from pg_class where relname = 'user_events' and relnamespace = 'public'::regnamespace) then
    raise exception 'Run 0008_phase7b_reliability.sql first.';
  end if;
end $$;

insert into public.app_settings (key, value) values
  ('product_events_keep_days', '180'),
  ('product_events_per_user_hour', '1200'),
  ('push_coalesce_seconds', '30'),
  ('push_message_delay_seconds', '2'),
  ('push_max_age_hours', '24'),
  ('push_max_attempts', '5'),
  ('push_outbox_keep_days', '14')
on conflict (key) do nothing;

-- ─── 1. Product events ───────────────────────────────────────────────────────

create table if not exists public.product_events (
  event_id       uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  event_type     text not null check (event_type ~ '^[a-z][a-z_]{1,39}$'),
  family         text not null check (family in ('content', 'people', 'worlds', 'messaging', 'after_dark', 'plans', 'outcome', 'app')),
  target_type    text check (target_type is null or target_type ~ '^[a-z_]{1,24}$'),
  target_id      text check (target_id is null or target_id ~ '^[A-Za-z0-9_:.\-]{1,80}$'),
  source_surface text check (source_surface is null or source_surface ~ '^[a-z_]{1,24}$'),
  -- The server's clock. `client_at` is only what the phone said (never trusted for ordering).
  created_at     timestamptz not null default now(),
  client_at      timestamptz,
  session_id     text check (session_id is null or session_id ~ '^[A-Za-z0-9_\-]{6,40}$'),
  context        jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 1200)
);
create index if not exists product_events_user_idx on public.product_events (user_id, created_at desc);
create index if not exists product_events_type_idx on public.product_events (event_type, created_at desc);
alter table public.product_events enable row level security;
-- No policies at all: the app can't read, update or delete events; it can
-- only add its own through log_product_events() below.

-- event_type → family (the allow-list).
create or replace function public._product_event_family(p_type text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_type in ('content_view', 'content_like', 'content_unlike', 'content_save', 'content_unsave', 'content_share',
                    'content_create', 'content_dislike', 'content_comment', 'poll_vote') then 'content'
    when p_type in ('profile_view', 'follow', 'unfollow', 'connect_request', 'connect_accept', 'connect_remove',
                    'crush_set', 'crush_remove', 'block') then 'people'
    when p_type in ('world_view', 'world_join', 'world_leave', 'world_follow', 'world_unfollow', 'world_create') then 'worlds'
    when p_type in ('conversation_open', 'message_sent', 'group_create', 'reaction_add', 'ping_send') then 'messaging'
    when p_type in ('after_dark_open', 'discover_view', 'discover_pass', 'vibe_request', 'vibe_accept', 'vibe_decline',
                    'vibe_pause', 'vibe_close', 'challenge_send', 'challenge_answer', 'photo_consent_change') then 'after_dark'
    when p_type in ('loop_open', 'loop_resolve', 'loop_dismiss', 'plan_propose', 'plan_confirm', 'plan_pause', 'plan_close') then 'plans'
    when p_type in ('suggestion_shown', 'suggestion_acted', 'suggestion_dismissed', 'why_shown', 'delta_shown', 'delta_opened',
                    'push_opened', 'push_enabled', 'push_disabled') then 'outcome'
    when p_type in ('app_open', 'app_foreground', 'surface_view', 'onboarding_step', 'sign_in', 'sign_out') then 'app'
  end;
$$;

-- Keep only short, scalar, non-sensitive context values.
create or replace function public._clean_event_context(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare out jsonb := '{}'::jsonb; k text; v jsonb; n int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out; end if;
  for k, v in select * from jsonb_each(p) loop
    exit when n >= 12;
    continue when k !~ '^[a-z][a-z0-9_]{0,31}$';
    -- Never content, credentials, contact details or media locations.
    continue when k ~ '(body|text|message|content|caption|comment|prompt|answer|title|url|uri|path|token|otp|jwt|password|secret|key|email|phone|name|address|reason_text|report)';
    if jsonb_typeof(v) in ('number', 'boolean') then
      out := out || jsonb_build_object(k, v); n := n + 1;
    elsif jsonb_typeof(v) = 'string' and char_length(v #>> '{}') <= 40 and (v #>> '{}') ~ '^[A-Za-z0-9_:.\-]*$'
          -- never an id of a person or a thing (ids belong in target_id, where the rules above apply)
          and (v #>> '{}') !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
      out := out || jsonb_build_object(k, v); n := n + 1;
    end if;
  end loop;
  return out;
end $$;

-- The app's only way in. Invalid items are dropped (never the whole batch);
-- returns how many were stored.
create or replace function public.log_product_events(p_events jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); e jsonb; fam text; typ text; tt text; tid text; src text; cat timestamptz; sid text; stored int := 0; recent int;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return 0; end if;
  if jsonb_array_length(p_events) > 50 then raise exception 'Too many events.' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = me) then return 0; end if;
  select count(*) into recent from public.product_events where user_id = me and created_at > now() - interval '1 hour';
  for e in select * from jsonb_array_elements(p_events) loop
    exit when recent + stored >= public._setting_int('product_events_per_user_hour', 1200);
    continue when jsonb_typeof(e) <> 'object';
    typ := e ->> 'event_type';
    fam := public._product_event_family(typ);
    continue when fam is null;
    tt := nullif(e ->> 'target_type', '');
    continue when tt is not null and tt not in ('buzz', 'drift', 'post', 'story', 'board', 'move', 'person', 'conversation', 'message',
                                                 'vibe', 'challenge', 'loop', 'plan', 'notification', 'surface', 'interest');
    tid := nullif(e ->> 'target_id', '');
    continue when tid is not null and tid !~ '^[A-Za-z0-9_:.\-]{1,80}$';
    -- Private, one-sided signals keep no target: who you have a Crush on, who
    -- you passed on or looked at in After Dark is never in analytics.
    if typ in ('crush_set', 'crush_remove', 'block') or (fam = 'after_dark' and tt = 'person') then tid := null; end if;
    -- A message is counted, never identified.
    if tt = 'message' then tid := null; end if;
    src := nullif(e ->> 'source_surface', '');
    if src is not null and src !~ '^[a-z_]{1,24}$' then src := 'other'; end if;
    begin
      cat := (e ->> 'client_at')::timestamptz;
      if cat > now() + interval '1 day' or cat < now() - interval '30 days' then cat := null; end if;
    exception when others then cat := null;
    end;
    sid := e ->> 'session_id';
    if sid is not null and sid !~ '^[A-Za-z0-9_\-]{6,40}$' then sid := null; end if;
    insert into public.product_events (user_id, event_type, family, target_type, target_id, source_surface, client_at, session_id, context)
    values (me, typ, fam, tt, tid, src, cat, sid, public._clean_event_context(e -> 'context'));
    stored := stored + 1;
  end loop;
  return stored;
end $$;

create or replace function public.purge_old_product_events() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.product_events where created_at < now() - make_interval(days => public._setting_int('product_events_keep_days', 180));
  get diagnostics n = row_count;
  return n;
end $$;

-- ─── 2. Push tokens ──────────────────────────────────────────────────────────

create table if not exists public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  token         text not null unique check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{8,200}\]$'),
  platform      text not null check (platform in ('ios', 'android', 'web')),
  -- A random id the app keeps per installation (not a hardware id).
  device_id     text check (device_id is null or device_id ~ '^[A-Za-z0-9_\-]{8,64}$'),
  -- The sign-in session that registered it: once that session is gone (signed
  -- out anywhere, revoked, expired), the server stops sending to this token
  -- even if the phone couldn't unregister (offline, dead session).
  session_id    uuid,
  app_version   text check (app_version is null or char_length(app_version) <= 32),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  failures      int not null default 0
);
alter table public.push_tokens add column if not exists session_id uuid;
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
drop policy if exists "push tokens own read" on public.push_tokens;
create policy "push tokens own read" on public.push_tokens for select to authenticated using (user_id = auth.uid());
-- No insert / update / delete policies: register / unregister below.

-- Register (or refresh) this device's token for the signed-in account. A
-- token already registered to another account on this phone moves here (one
-- phone, one current account); an older token of this installation is replaced.
create or replace function public.register_push_token(p_token text, p_platform text, p_device_id text default null, p_app_version text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); sid uuid;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  begin
    sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then sid := null;
  end;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{8,200}\]$' then raise exception 'Not a push token.' using errcode = '22023'; end if;
  if p_platform not in ('ios', 'android', 'web') then raise exception 'Unknown platform.' using errcode = '22023'; end if;
  if p_device_id is not null and p_device_id !~ '^[A-Za-z0-9_\-]{8,64}$' then p_device_id := null; end if;
  if (select count(*) from public.push_tokens where user_id = me and token <> p_token) >= 10 then
    -- At most 10 devices: the oldest goes.
    delete from public.push_tokens where id = (select id from public.push_tokens where user_id = me order by updated_at limit 1);
  end if;
  if p_device_id is not null then
    delete from public.push_tokens where device_id = p_device_id and user_id = me and token <> p_token;
  end if;
  insert into public.push_tokens (user_id, token, platform, device_id, app_version, session_id)
  values (me, p_token, p_platform, p_device_id, left(p_app_version, 32), sid)
  on conflict (token) do update
    set user_id = me, platform = excluded.platform, device_id = coalesce(excluded.device_id, public.push_tokens.device_id),
        app_version = excluded.app_version, session_id = excluded.session_id, updated_at = now(), failures = 0;
end $$;

-- Sign-out on this phone: stop pushes to it. Only your own token.
create or replace function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

-- ─── 3. Notification preferences ─────────────────────────────────────────────

create table if not exists public.notification_prefs (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  messages    boolean not null default true,
  connections boolean not null default true,
  after_dark  boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
drop policy if exists "prefs own read" on public.notification_prefs;
create policy "prefs own read" on public.notification_prefs for select to authenticated using (user_id = auth.uid());
-- Writes through set_notification_prefs() (no direct write policies).

create or replace function public.set_notification_prefs(p_messages boolean default null, p_connections boolean default null, p_after_dark boolean default null)
returns public.notification_prefs
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.notification_prefs;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  insert into public.notification_prefs (user_id) values (me) on conflict (user_id) do nothing;
  update public.notification_prefs
     set messages = coalesce(p_messages, messages), connections = coalesce(p_connections, connections),
         after_dark = coalesce(p_after_dark, after_dark), updated_at = now()
   where user_id = me returning * into r;
  return r;
end $$;

create or replace function public._push_allowed(p_user uuid, p_category text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case p_category when 'messages' then messages when 'connections' then connections when 'after_dark' then after_dark end
                     from public.notification_prefs where user_id = p_user), true);
$$;

-- ─── 4. Push outbox ──────────────────────────────────────────────────────────

create table if not exists public.push_outbox (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,   -- recipient
  actor_id        uuid references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('MESSAGE_RECEIVED', 'AFTER_DARK_MESSAGE', 'CONNECTION_REQUEST', 'CONNECTION_ACCEPTED',
                                                'MUTUAL_CRUSH', 'VIBE_REQUEST', 'VIBE_ACCEPTED', 'CHALLENGE_YOUR_TURN', 'PLAN_WAITING_FOR_YOU')),
  category        text not null check (category in ('messages', 'connections', 'after_dark')),
  -- One push per message per recipient / per event: a retried trigger, a
  -- second webhook or a re-run can never produce a second notification.
  dedupe_key      text not null unique,
  -- The thread a message push belongs to (a burst in it is coalesced into one).
  collapse_key    text,
  source_id       uuid,          -- the message / user_event it came from (re-checked before sending)
  title           text not null check (char_length(title) <= 80),
  body            text not null check (char_length(body) <= 160),
  data            jsonb not null default '{}'::jsonb,
  coalesced       int not null default 1,
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  tickets         jsonb,         -- [{token, ticket}] from Expo
  receipts_at     timestamptz,
  error           text check (error is null or char_length(error) <= 200),
  created_at      timestamptz not null default now()
);
create index if not exists push_outbox_due_idx on public.push_outbox (next_attempt_at) where status = 'pending';
create index if not exists push_outbox_coalesce_idx on public.push_outbox (user_id, collapse_key, created_at desc) where status = 'pending';
create index if not exists push_outbox_receipts_idx on public.push_outbox (sent_at) where status = 'sent' and receipts_at is null;
alter table public.push_outbox enable row level security;
-- No policies: nobody reads or writes it through the API.

create or replace function public._first_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select left(coalesce(nullif(split_part(btrim(regexp_replace(p.display_name, '[[:cntrl:]]', ' ', 'g')), ' ', 1), ''), p.username::text, 'Someone'), 30)
    from public.profiles p where p.id = p_user;
$$;

-- Queue one notification (internal). Skips: yourself, blocks, preference off,
-- no device. A burst in one thread folds into the pending notification.
create or replace function public._push_enqueue(p_user uuid, p_actor uuid, p_kind text, p_category text, p_dedupe text, p_collapse text,
                                                p_source uuid, p_title text, p_body text, p_data jsonb, p_plural_body text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare pending public.push_outbox;
begin
  if p_user is null or p_user = p_actor then return; end if;
  -- A notification must never cost the message or the relationship change it
  -- is about: any failure here is logged and swallowed (the action stands).
  begin
  if p_actor is not null and public.is_blocked_between(p_user, p_actor) then return; end if;
  if not public._push_allowed(p_user, p_category) then return; end if;
  if not exists (select 1 from public.push_tokens where user_id = p_user) then return; end if;
  if p_collapse is not null and p_plural_body is not null then
    select * into pending from public.push_outbox
     where user_id = p_user and collapse_key = p_collapse and status = 'pending'
       and created_at > now() - make_interval(secs => public._setting_int('push_coalesce_seconds', 30))
     order by created_at desc limit 1 for update skip locked;
    if found then
      -- (A message row fires its trigger once, so no extra dedupe row is needed.)
      update public.push_outbox
         set coalesced = coalesced + 1, body = left(replace(p_plural_body, '{n}', (pending.coalesced + 1)::text), 160)
       where id = pending.id;
      return;
    end if;
  end if;
  insert into public.push_outbox (user_id, actor_id, kind, category, dedupe_key, collapse_key, source_id, title, body, data, next_attempt_at)
  values (p_user, p_actor, p_kind, p_category, p_dedupe, p_collapse, p_source, left(p_title, 80), left(p_body, 160), coalesce(p_data, '{}'::jsonb),
          -- Messages wait a moment so a quick burst becomes one notification.
          case when p_collapse is not null then now() + make_interval(secs => public._setting_int('push_message_delay_seconds', 2)) else now() end)
  on conflict (dedupe_key) do nothing;
  exception when others then
    raise warning 'push enqueue skipped (%): %', p_kind, sqlstate;
  end;
end $$;

-- Messages → push. Normal chats name the sender (never the text); After Dark
-- (Vibe) chats are generic. Only people still in the chat; never the sender.
create or replace function public.messages_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations; m record; who text; grp text;
begin
  if new.deleted_at is not null then return new; end if;
  begin
  select * into c from public.conversations where id = new.conversation_id;
  if not found then return new; end if;
  who := public._first_name(new.sender_id);
  for m in select cm.user_id, cm.status from public.conversation_members cm
            where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id and cm.status in ('active', 'request') loop
    if c.kind = 'vibe' then
      perform public._push_enqueue(m.user_id, new.sender_id, 'AFTER_DARK_MESSAGE', 'after_dark', 'message:' || new.id || ':' || m.user_id,
        'conv:' || c.id, new.id, 'Chimp', 'New After Dark message',
        jsonb_build_object('type', 'vibe_message', 'conversation_id', c.id, 'vibe_id', (select v.id from public.vibes v where v.conversation_id = c.id)),
        'New After Dark messages');
    elsif c.kind = 'group' then
      grp := left(btrim(regexp_replace(coalesce(c.title, 'your group'), '[[:cntrl:]]', ' ', 'g')), 40);
      perform public._push_enqueue(m.user_id, new.sender_id, 'MESSAGE_RECEIVED', 'messages', 'message:' || new.id || ':' || m.user_id,
        'conv:' || c.id, new.id, grp, who || ' sent a message',
        jsonb_build_object('type', 'group_message', 'conversation_id', c.id), '{n} new messages');
    elsif m.status = 'request' then
      perform public._push_enqueue(m.user_id, new.sender_id, 'MESSAGE_RECEIVED', 'messages', 'message:' || new.id || ':' || m.user_id,
        'conv:' || c.id, new.id, 'Chimp', who || ' sent you a message request',
        jsonb_build_object('type', 'message', 'conversation_id', c.id, 'user_id', new.sender_id), who || ' sent you a message request');
    else
      perform public._push_enqueue(m.user_id, new.sender_id, 'MESSAGE_RECEIVED', 'messages', 'message:' || new.id || ':' || m.user_id,
        'conv:' || c.id, new.id, 'Chimp', who || ' sent you a message',
        jsonb_build_object('type', 'message', 'conversation_id', c.id, 'user_id', new.sender_id), who || ' sent you {n} messages');
    end if;
  end loop;
  exception when others then
    raise warning 'messages_push skipped: %', sqlstate;   -- the message itself always goes through
  end;
  return new;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages for each row execute function public.messages_push();

-- user_events (0008) → push. Everything romantic or After Dark is generic:
-- never a name, never a Crush, never what a challenge or plan says.
create or replace function public.user_events_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; hr text := to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'); dy text := to_char(now(), 'YYYYMMDD');
        pair text := least(new.user_id, coalesce(new.actor_id, new.user_id))::text || greatest(new.user_id, coalesce(new.actor_id, new.user_id))::text;
begin
  begin
  who := case when new.actor_id is not null then public._first_name(new.actor_id) else 'Someone' end;
  -- Dedupe keys are throttled (per person per hour / day): toggling a request
  -- or a Crush on and off can't turn into a stream of notifications.
  case new.kind
    when 'connection_request' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'CONNECTION_REQUEST', 'connections', 'connreq:' || new.actor_id || ':' || new.user_id || ':' || hr, null, new.id,
        'Chimp', who || ' wants to connect', jsonb_build_object('type', 'connection', 'user_id', new.actor_id));
    when 'connection_accepted' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'CONNECTION_ACCEPTED', 'connections', 'connacc:' || new.actor_id || ':' || new.user_id || ':' || dy, null, new.id,
        'Chimp', who || ' accepted your connection', jsonb_build_object('type', 'connection', 'user_id', new.actor_id));
    -- After Dark: generic text AND a neutral payload (no "crush" anywhere, even hidden).
    when 'mutual_crush' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'MUTUAL_CRUSH', 'after_dark', 'mutual:' || pair || ':' || new.user_id || ':' || dy, null, new.id,
        'Chimp', 'Something new is waiting for you', jsonb_build_object('type', 'after_dark', 'tab', 'vibes'));
    when 'vibe_request' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'VIBE_REQUEST', 'after_dark', 'vibereq:' || coalesce(new.ref_id::text, pair) || ':' || new.user_id, null, new.id,
        'Chimp', 'Someone sent you a Vibe request', jsonb_build_object('type', 'after_dark', 'tab', 'inbox'));
    when 'vibe_accepted' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'VIBE_ACCEPTED', 'after_dark', 'vibeacc:' || coalesce(new.ref_id::text, pair) || ':' || new.user_id, null, new.id,
        'Chimp', 'Your Vibe request was accepted', jsonb_build_object('type', 'vibe', 'vibe_id', new.ref_id));
    when 'challenge_your_turn' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'CHALLENGE_YOUR_TURN', 'after_dark', 'event:' || new.id, null, new.id,
        'Chimp', 'A challenge is waiting for you', jsonb_build_object('type', 'challenge', 'challenge_id', new.ref_id));
    when 'plan_waiting' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'PLAN_WAITING_FOR_YOU', 'after_dark', 'plan:' || coalesce(new.ref_id::text, pair) || ':' || new.user_id || ':' || hr, null, new.id,
        'Chimp', 'A plan is waiting for you', jsonb_build_object('type', 'after_dark', 'tab', 'plans'));
    else
      null;
  end case;
  exception when others then
    raise warning 'user_events_push skipped: %', sqlstate;   -- the relationship change always stands
  end;
  return new;
end $$;
drop trigger if exists user_events_push on public.user_events;
create trigger user_events_push after insert on public.user_events for each row execute function public.user_events_push();

-- ── Server side of sending (the `push` Edge Function, service key only) ──

-- Claim due notifications. Re-checks everything that may have changed since
-- they were queued (block, preference, unsent message, no device left).
create or replace function public.push_claim(p_limit int default 100)
returns table (id uuid, user_id uuid, kind text, title text, body text, data jsonb, collapse_key text, attempts int, tokens text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  -- Never wait on another worker's rows (no queueing, no deadlocks): every
  -- step only touches rows it could lock right away.
  -- A worker that died mid-send: back to the queue after 5 minutes (or failed at the attempt limit).
  update public.push_outbox o
     set status = case when o.attempts >= public._setting_int('push_max_attempts', 5) then 'failed' else 'pending' end,
         claimed_at = null, error = coalesce(o.error, 'worker timeout')
   where o.id in (select x.id from public.push_outbox x
                   where x.status = 'sending' and x.claimed_at < now() - interval '5 minutes' for update skip locked);
  -- Things that no longer apply are skipped, not sent.
  update public.push_outbox o set status = 'skipped', error = 'no longer applies'
   where o.id in (
     select x.id from public.push_outbox x
      where x.status = 'pending' and x.next_attempt_at <= now()
        and (x.created_at < now() - make_interval(hours => public._setting_int('push_max_age_hours', 24))   -- too late to be useful
             or (x.actor_id is not null and public.is_blocked_between(x.user_id, x.actor_id))
             or not public._push_allowed(x.user_id, x.category)
             or not exists (select 1 from public.push_tokens t where t.user_id = x.user_id)
             or (x.kind in ('MESSAGE_RECEIVED', 'AFTER_DARK_MESSAGE') and (
                   -- unsent before it went out (a burst survives if any of it is still there)
                   (x.coalesced = 1 and not exists (select 1 from public.messages msg where msg.id = x.source_id and msg.deleted_at is null))
                   -- left / removed from the chat since
                   or not exists (select 1 from public.conversation_members cm
                                   where cm.conversation_id = (x.data ->> 'conversation_id')::uuid and cm.user_id = x.user_id
                                     and cm.status in ('active', 'request')))))
      for update skip locked);
  return query
  with due as (
    select o.id from public.push_outbox o
     where o.status = 'pending' and o.next_attempt_at <= now()
     order by o.next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update skip locked
  ), claimed as (
    update public.push_outbox o set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
      from due where o.id = due.id
    returning o.*
  )
  select c.id, c.user_id, c.kind, c.title, c.body, c.data, c.collapse_key, c.attempts,
         -- Only devices whose sign-in session still exists (signed out / revoked = no more pushes).
         array(select t.token from public.push_tokens t
                where t.user_id = c.user_id
                  and (t.session_id is null or exists (select 1 from auth.sessions s where s.id = t.session_id))
                order by t.updated_at desc)
    from claimed c;
end $$;

-- Seconds until the next queued notification is due (null: nothing queued).
-- Lets one run wait out the short message delay instead of needing another.
create or replace function public.push_next_due_in() returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, extract(epoch from min(next_attempt_at) - now()))::numeric
    from public.push_outbox where status = 'pending';
$$;

-- Record a send attempt. p_retry: back off and try again (until push_max_attempts).
create or replace function public.push_mark(p_id uuid, p_ok boolean, p_tickets jsonb default null, p_error text default null, p_retry boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare o public.push_outbox;
begin
  select * into o from public.push_outbox where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update public.push_outbox set status = 'sent', sent_at = now(), tickets = p_tickets, error = left(p_error, 200) where id = p_id;
  elsif p_retry and o.attempts < public._setting_int('push_max_attempts', 5) then
    update public.push_outbox
       set status = 'pending', claimed_at = null, error = left(p_error, 200),
           next_attempt_at = now() + make_interval(secs => least(3600, 15 * power(2, o.attempts)::int))
     where id = p_id;
  else
    update public.push_outbox set status = 'failed', error = left(p_error, 200) where id = p_id;
  end if;
end $$;

-- Expo says this token is dead (DeviceNotRegistered): forget it.
create or replace function public.push_token_invalid(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token;
$$;

-- Sent notifications whose receipts haven't been checked (Expo keeps receipts ~24 h).
create or replace function public.push_receipts_due(p_limit int default 300)
returns table (id uuid, tickets jsonb)
language sql security definer set search_path = public as $$
  select o.id, o.tickets from public.push_outbox o
   where o.status = 'sent' and o.receipts_at is null and o.tickets is not null
     and o.sent_at < now() - interval '15 minutes' and o.sent_at > now() - interval '23 hours'
   order by o.sent_at limit greatest(1, least(coalesce(p_limit, 300), 1000));
$$;

create or replace function public.push_receipts_done(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.push_outbox set receipts_at = now() where id = any (p_ids);
$$;

create or replace function public.purge_push_outbox() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.push_outbox where created_at < now() - make_interval(days => public._setting_int('push_outbox_keep_days', 14))
    and status in ('sent', 'failed', 'skipped');
  get diagnostics n = row_count;
  return n;
end $$;

-- ─── 5. Follow / Crush intents (idempotent) ─────────────────────────────────

-- Returns whether you follow them afterwards. A repeat tap changes nothing.
create or replace function public.set_follow(p_other uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_on is null or p_other is null or p_other = me or not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'Not available.' using errcode = '22023';
  end if;
  if p_on then
    if public.is_blocked_between(me, p_other) then raise exception 'Not available.' using errcode = '22023'; end if;
    insert into public.follows (follower_id, followee_id) values (me, p_other) on conflict do nothing;
  else
    delete from public.follows where follower_id = me and followee_id = p_other;
  end if;
  return exists (select 1 from public.follows where follower_id = me and followee_id = p_other);
end $$;

-- Your private Crush. Returns {crush, mutual}: `mutual` is true only when
-- they chose you too (exactly what my_sparks() already reveals); a one-way
-- Crush tells nobody anything.
create or replace function public.set_crush(p_other uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); on_now boolean;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_on is null or p_other is null or p_other = me or not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'Not available.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('crush:' || least(me, p_other)::text || greatest(me, p_other)::text));
  if p_on then
    if public.is_blocked_between(me, p_other) then raise exception 'Not available.' using errcode = '22023'; end if;
    insert into public.crushes (from_id, to_id) values (me, p_other) on conflict do nothing;
  else
    delete from public.crushes where from_id = me and to_id = p_other;
  end if;
  on_now := exists (select 1 from public.crushes where from_id = me and to_id = p_other);
  return jsonb_build_object('crush', on_now,
    'mutual', on_now and exists (select 1 from public.crushes where from_id = p_other and to_id = me));
end $$;

-- Older app versions write follows / crushes directly: the same block rule
-- applies there. A trigger quietly drops the row (no error, so a blocked
-- person can't use it to find out they were blocked); the RLS policies are
-- unchanged.
create or replace function public.follows_block_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_blocked_between(new.follower_id, new.followee_id) then return null; end if;
  return new;
end $$;
create or replace function public.crushes_block_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_blocked_between(new.from_id, new.to_id) then return null; end if;
  return new;
end $$;
drop trigger if exists follows_block_guard on public.follows;
create trigger follows_block_guard before insert on public.follows for each row execute function public.follows_block_guard();
drop trigger if exists crushes_block_guard on public.crushes;
create trigger crushes_block_guard before insert on public.crushes for each row execute function public.crushes_block_guard();

-- ─── Grants ──────────────────────────────────────────────────────────────────

-- Internal helpers and triggers: never callable through the API.
revoke execute on function public._product_event_family(text), public._clean_event_context(jsonb), public._push_allowed(uuid, text),
  public._first_name(uuid), public._push_enqueue(uuid, uuid, text, text, text, text, uuid, text, text, jsonb, text),
  public.messages_push(), public.user_events_push(), public.follows_block_guard(), public.crushes_block_guard() from public, anon, authenticated;
-- Server only (the `push` Edge Function and scheduled jobs, with the server key).
revoke execute on function public.push_claim(int), public.push_mark(uuid, boolean, jsonb, text, boolean), public.push_token_invalid(text),
  public.push_receipts_due(int), public.push_receipts_done(uuid[]), public.purge_push_outbox(), public.purge_old_product_events(),
  public.push_next_due_in()
  from public, anon, authenticated;
grant execute on function public.push_claim(int), public.push_mark(uuid, boolean, jsonb, text, boolean), public.push_token_invalid(text),
  public.push_receipts_due(int), public.push_receipts_done(uuid[]), public.purge_push_outbox(), public.purge_old_product_events(),
  public.push_next_due_in()
  to service_role;
-- The app.
revoke execute on function public.log_product_events(jsonb), public.register_push_token(text, text, text, text), public.unregister_push_token(text),
  public.set_notification_prefs(boolean, boolean, boolean), public.set_follow(uuid, boolean), public.set_crush(uuid, boolean)
  from public, anon;
grant execute on function public.log_product_events(jsonb), public.register_push_token(text, text, text, text), public.unregister_push_token(text),
  public.set_notification_prefs(boolean, boolean, boolean), public.set_follow(uuid, boolean), public.set_crush(uuid, boolean)
  to authenticated;

commit;
