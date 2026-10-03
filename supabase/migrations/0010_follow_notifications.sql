-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Build 5 patch · Follow notifications
--
-- Run AFTER 0009 (it checks). Idempotent: safe to run twice. Never re-run
-- 0001–0009 after it. RLS unchanged; no new tables, no new policies.
--
--   When A follows B, B gets ONE in-app event (user_events kind 'follow') and,
--   through the existing 0009 pipeline (push_outbox → `push` Edge Function →
--   Expo → APNs), ONE push: "Aayush followed you". Tapping it opens A's profile.
--     - only the person followed; never the follower
--     - an unfollow sends nothing
--     - follow → unfollow → follow again within 24 h: no second event or push
--     - blocks: no follow across a block (0009 guard) and _emit skips blocked pairs
--     - Notification settings: under "Connections"
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  if not exists (select 1 from pg_class where relname = 'push_outbox' and relnamespace = 'public'::regnamespace) then
    raise exception 'Run 0009_phase7c_product_intelligence.sql first.';
  end if;
end $$;

-- 1. New kinds: user_events 'follow', push_outbox 'FOLLOW_RECEIVED'.
do $$ declare r record; begin
  for r in select conname from pg_constraint
            where conrelid = 'public.user_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.user_events drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint
            where conrelid = 'public.push_outbox'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' and pg_get_constraintdef(oid) like '%MESSAGE_RECEIVED%' loop
    execute format('alter table public.push_outbox drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.user_events add constraint user_events_kind_check check (kind in (
  'connection_request', 'connection_accepted', 'connection_updated',
  'mutual_crush', 'relationship_updated',
  'vibe_request', 'vibe_accepted', 'vibe_updated',
  'challenge_your_turn', 'challenge_completed',
  'plan_waiting', 'plan_updated',
  'message_received',
  'follow'));
alter table public.push_outbox add constraint push_outbox_kind_check check (kind in (
  'MESSAGE_RECEIVED', 'AFTER_DARK_MESSAGE', 'CONNECTION_REQUEST', 'CONNECTION_ACCEPTED', 'FOLLOW_RECEIVED',
  'MUTUAL_CRUSH', 'VIBE_REQUEST', 'VIBE_ACCEPTED', 'CHALLENGE_YOUR_TURN', 'PLAN_WAITING_FOR_YOU'));

-- 2. follows → user_events (a genuine new follow only; at most one per pair per 24 h).
create or replace function public.follows_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if exists (select 1 from public.user_events e
                where e.user_id = new.followee_id and e.actor_id = new.follower_id and e.kind = 'follow'
                  and e.created_at > now() - interval '24 hours') then
      return new;
    end if;
    perform public._emit(new.followee_id, 'follow', new.follower_id, null);
  exception when others then
    raise warning 'follows_events skipped: %', sqlstate;   -- the follow itself always stands
  end;
  return new;
end $$;
drop trigger if exists follows_events on public.follows;
create trigger follows_events after insert on public.follows for each row execute function public.follows_events();

-- 3. user_events → push: the 0009 function plus the 'follow' case.
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
    -- 0010: someone followed you (normal social: their first name, opens their profile).
    when 'follow' then
      perform public._push_enqueue(new.user_id, new.actor_id, 'FOLLOW_RECEIVED', 'connections', 'follow:' || new.actor_id || ':' || new.user_id || ':' || dy, null, new.id,
        'Chimp', who || ' followed you', jsonb_build_object('type', 'connection', 'user_id', new.actor_id));
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

revoke execute on function public.follows_events(), public.user_events_push() from public, anon, authenticated;

commit;
