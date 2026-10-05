-- ════════════════════════════════════════════════════════════════════════════
-- Chimp · Phase 8 · Messaging v2: Sent / Delivered / Seen
--
-- Run AFTER 0010 (it checks). Idempotent: safe to run twice. Never re-run or
-- edit 0001–0010. RLS stays on; no table loses a policy without an equal or
-- stricter replacement; no `with check (true)`.
--
-- Read model (one cursor pair per member, all SERVER time — never device time):
--   last_read_at       (0002) "I have SEEN everything up to here"
--   last_delivered_at  (new)  "my app has RECEIVED everything up to here"
-- Both only ever move forward. A message is
--   Sent       once the server has it (the row exists);
--   Delivered  when a recipient's app synced it and said so (mark_delivered);
--              a push being sent does NOT count;
--   Seen       when a recipient had the chat open, app in the foreground
--              (mark_read_upto). Seen implies Delivered.
--
-- Who sees receipts (chat_receipts):
--   - only current members (active / request — not someone who declined or left);
--   - never across a block (either direction);
--   - not from someone who hasn't accepted your message request yet;
--   - never in After Dark Vibes (policy D: no receipts at all, either side).
-- And so the raw table can't be used to get around that ("members read"):
--   - in a Vibe you read only your own member row;
--   - in a 1:1, the other person's row is hidden while they haven't accepted
--     your request, and while either of you has blocked the other.
-- Delivery cursors only move for ACTIVE members who share no block with
-- anyone in that conversation (so a request recipient's or a blocker's app
-- syncing never tells anyone they're online).
--
-- Build 5 compatibility: mark_conversation_read (0002) is unchanged and still
-- works; Build 5 never calls the new functions, so its recipients simply show
-- "Sent" until they open the chat ("Seen"). Nothing is renamed or removed.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.user_events'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%''follow''%'
  ) then
    raise exception 'Run 0010_follow_notifications.sql first.';
  end if;
end $$;

-- 1. Delivery cursor. Existing rows: everything already read was delivered.
alter table public.conversation_members add column if not exists last_delivered_at timestamptz;
update public.conversation_members set last_delivered_at = last_read_at where last_delivered_at is null;

-- 2. Seen: move MY read cursor forward to a message's server time.
--    p_message_id given → up to that message (must be in this conversation,
--    otherwise nothing happens); null → up to the newest message.
--    Never moves backwards; a repeat call is a no-op (no row churn, no
--    realtime noise). Returns my read cursor afterwards (null if not a member).
create or replace function public.mark_read_upto(p_cid uuid, p_message_id uuid default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  upto timestamptz;
  cur timestamptz;
  st text;
  ack boolean;
begin
  if me is null or p_cid is null then return null; end if;
  select m.last_read_at, m.status into cur, st from public.conversation_members m
   where m.conversation_id = p_cid and m.user_id = me and m.status <> 'left';
  if not found then return null; end if;
  -- The delivery cursor moves only for an active member who shares no block
  -- with anyone in the conversation (1:1 or group): a pending request or a
  -- block never tells anyone when this person's app is online.
  ack := st = 'active' and not public.conversation_blocked(p_cid);

  if p_message_id is null then
    select max(x.created_at) into upto from public.messages x where x.conversation_id = p_cid;
  else
    select x.created_at into upto from public.messages x where x.id = p_message_id and x.conversation_id = p_cid;
  end if;
  if upto is null then return cur; end if;

  update public.conversation_members m
     set last_read_at = greatest(m.last_read_at, upto),
         last_delivered_at = case when ack then greatest(coalesce(m.last_delivered_at, upto), upto) else m.last_delivered_at end
   where m.conversation_id = p_cid and m.user_id = me
     and (m.last_read_at < upto or (ack and (m.last_delivered_at is null or m.last_delivered_at < upto)))
  returning m.last_read_at into cur;
  return cur;
end;
$$;

-- 3. Delivered: my app has synced these conversations (all of mine when
--    p_cid is null). Moves my delivery cursor up to the newest message from
--    someone else. Only where I'm an ACTIVE member (not a pending request);
--    skips Vibes (no receipts there) and any conversation where I share a
--    block with someone (1:1 or group) — those simply stay "Sent" until Seen.
--    Returns how many cursors moved.
create or replace function public.mark_delivered(p_cid uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  n integer;
begin
  if me is null then return 0; end if;
  with latest as (
    select m.conversation_id, max(x.created_at) as upto
      from public.conversation_members m
      join public.conversations c on c.id = m.conversation_id and c.kind <> 'vibe'
      join public.messages x on x.conversation_id = m.conversation_id and x.sender_id <> me
     where m.user_id = me and m.status = 'active'
       and (p_cid is null or m.conversation_id = p_cid)
       and not public.conversation_blocked(m.conversation_id)
     group by m.conversation_id
  )
  update public.conversation_members m
     set last_delivered_at = l.upto
    from latest l
   where m.conversation_id = l.conversation_id and m.user_id = me
     and (m.last_delivered_at is null or m.last_delivered_at < l.upto);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 4. Receipts for one conversation, already filtered for privacy.
--    One row per current member (active / request) plus me. For anyone who
--    hasn't accepted my request yet, cursors are null (they show as Sent).
--    delivered_at already includes "seen ⇒ delivered".
create or replace function public.chat_receipts(p_cid uuid)
returns table (user_id uuid, status text, joined_at timestamptz, read_at timestamptz, delivered_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.status, m.joined_at,
         case when m.user_id = auth.uid() or m.status = 'active' then m.last_read_at end,
         case when m.user_id = auth.uid() or m.status = 'active' then greatest(coalesce(m.last_delivered_at, m.last_read_at), m.last_read_at) end
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
   where m.conversation_id = p_cid
     and auth.uid() is not null
     and exists (select 1 from public.conversation_members me
                  where me.conversation_id = p_cid and me.user_id = auth.uid() and me.status in ('active', 'request'))
     and c.kind <> 'vibe'
     and (m.user_id = auth.uid()
          or (m.status in ('active', 'request') and not public.is_blocked_between(auth.uid(), m.user_id)));
$$;

-- 5. Other people's member rows, enforced by the database (by query AND by
--    Realtime, which applies the same policy). YOUR OWN row stays readable
--    everywhere through 0006's "members read own".
--      - Vibe (After Dark policy D): never the partner's row.
--      - 1:1: not while they haven't accepted your request (status 'request'),
--        and not while either of you has blocked the other.
--      - Groups: as before (the member list needs it; pending invites show as
--        "Invited"). Receipts there are filtered by chat_receipts.
drop policy if exists "members read" on public.conversation_members;
create policy "members read" on public.conversation_members for select to authenticated using (
  public.is_conversation_member(conversation_id)
  and coalesce(public.conversation_kind(conversation_id), '') <> 'vibe'
  and not (public.conversation_kind(conversation_id) = 'direct'
           and (status = 'request' or public.conversation_blocked(conversation_id)))
);

-- 6. Grants: signed-in people only.
revoke execute on function public.mark_read_upto(uuid, uuid) from public, anon;
revoke execute on function public.mark_delivered(uuid) from public, anon;
revoke execute on function public.chat_receipts(uuid) from public, anon;
grant execute on function public.mark_read_upto(uuid, uuid) to authenticated;
grant execute on function public.mark_delivered(uuid) to authenticated;
grant execute on function public.chat_receipts(uuid) to authenticated;

commit;
