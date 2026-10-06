import { router } from 'expo-router';
import { Search as SearchIcon, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { InterestChip } from '@/components/ui/Chip';
import { Img } from '@/components/ui/Img';
import { EmptyState } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { openWorldActions } from '@/components/worlds/WorldActionSheet';
import { interestById } from '@/data/interests';
import { type PersonHit, searchPeople } from '@/services/backend/people';
import { repo } from '@/services/repository';
import { colors, radius } from '@/theme';
import type { Href } from 'expo-router';
import type { ImageSrc } from '@/types/models';
import { compact } from '@/utils/format';

interface Row {
  key: string;
  title: string;
  subtitle: string;
  image?: ImageSrc;
  round?: boolean;
  href: Href;
  /** Phase 9: a World (long-press → Pin / Unpin). */
  boardId?: string;
}

const SUGGESTIONS = ['Tokyo', 'co-founder', 'rooftop', 'photography', 'Lisbon', 'ramen'];

/** "by @misu" · "Your World" · "Chimp World" — who a World belongs to. */
function worldOwnerLine(ownerId?: string): string {
  if (!ownerId) return 'Chimp World';
  if (repo.isMe(ownerId)) return 'Your World';
  const u = repo.user(ownerId);
  return u?.username ? `by @${u.username}` : u ? `by ${u.displayName}` : 'A member’s World';
}

function matches(q: string, ...fields: (string | undefined)[]) {
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/**
 * Search across people, Boards and Moves on this phone — and (REAL, Phase
 * 7B) people on the server too, so someone who just joined can be found
 * before they show up anywhere in your world.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const remote = useRemotePeople(query);

  const sections = useMemo(() => {
    if (!query) return [];
    const people: Row[] = repo
      .people()
      .filter((u) => matches(query, u.displayName, u.username, u.city, u.bio, ...u.interests.map((i) => interestById[i]?.label), ...(u.knownFor ?? [])))
      // Phase 9: names aren't unique — the @username identifies the person.
      .map((u) => ({ key: u.id, title: u.displayName, subtitle: [u.username ? `@${u.username}` : null, u.city].filter(Boolean).join(' · '), image: u.avatar, round: true, href: `/profile/${u.id}` }));
    const boards: Row[] = repo
      .boards()
      .filter((b) => matches(query, b.title, b.tagline, b.city, ...b.interests.map((i) => interestById[i]?.label)))
      // Phase 9: World names aren't unique either ("NYC Rooftops" by two people):
      // every result says whose it is, and opens by its id, never its name.
      .map((b) => ({ key: b.id, title: b.title, subtitle: [worldOwnerLine(b.ownerId), b.visibility === 'private' ? 'Private' : b.visibility === 'connections' ? 'Connections' : null, b.memberCount ? `${compact(b.memberCount)} ${b.memberCount === 1 ? 'member' : 'members'}` : null].filter(Boolean).join(' · '), image: b.cover, href: `/board/${b.id}`, boardId: b.id }));
    const moves: Row[] = repo
      .moves()
      .filter((m) => matches(query, m.title, m.subtitle, m.city, m.description, ...m.interests.map((i) => interestById[i]?.label)))
      .map((m) => ({ key: m.id, title: m.title, subtitle: `Move · ${m.city} · ${m.dateLabel}`, image: m.image, href: `/move/${m.id}` }));
    const local = new Set(people.map((p) => p.key));
    for (const h of remote) {
      if (local.has(h.id) || repo.isMe(h.id)) continue;
      const name = h.display_name || (h.username ? `@${h.username}` : 'Someone');
      people.push({ key: h.id, title: name, subtitle: [h.username ? `@${h.username}` : null, h.city].filter(Boolean).join(' · '), image: h.avatar_url ?? undefined, round: true, href: `/profile/${h.id}` });
    }
    return [
      { title: 'People', data: people },
      { title: 'Worlds', data: boards },
      { title: 'Moves', data: moves },
    ].filter((s) => s.data.length);
  }, [query, remote]);

  const go = (href: Href) => {
    router.back();
    setTimeout(() => router.push(href), 200);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={styles.grabber} />
      <View style={styles.bar}>
        <View style={styles.input}>
          <SearchIcon size={20} color={colors.inkMuted} />
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder="Search people, @usernames or Worlds"
            placeholderTextColor={colors.inkFaint}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.text}
          />
        </View>
        <Tap onPress={() => router.back()} style={styles.cancel} accessibilityLabel="Cancel search">
          <T v="callout" color={colors.accent} weight="600">
            Cancel
          </T>
        </Tap>
      </View>

      {!query ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <T v="label" color={colors.inkFaint} style={{ marginBottom: 10 }}>
            TRY
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SUGGESTIONS.map((s) => (
              <InterestChip key={s} label={s} onPress={() => setQ(s)} />
            ))}
          </View>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
          renderSectionHeader={({ section }) => (
            <T v="label" color={colors.inkFaint} style={{ marginTop: 18, marginBottom: 8, marginLeft: 4 }}>
              {section.title.toUpperCase()}
            </T>
          )}
          renderItem={({ item }) => (
            <Tap
              onPress={() => go(item.href)}
              onLongPress={item.boardId ? () => openWorldActions(item.boardId!) : undefined}
              delayLongPress={380}
              accessibilityLabel={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ''}`}
              accessibilityHint={item.boardId ? 'Long-press to pin' : undefined}
              scaleTo={0.985}
              style={styles.row}
            >
              {item.round ? <Avatar uri={item.image} name={item.title} size={48} /> : <Img uri={item.image} style={styles.thumb} />}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <T v="bodyStrong">{item.title}</T>
                <T v="footnote" color={colors.inkMuted} numberOfLines={1}>
                  {item.subtitle}
                </T>
              </View>
            </Tap>
          )}
          ListEmptyComponent={<EmptyState icon={<X size={22} color={colors.accent} />} title="No matches yet" body={`Nothing in your graph matches “${q}”.`} />}
        />
      )}
    </KeyboardAvoidingView>
  );
}

/** REAL accounts: server search (debounced; quietly empty offline or before 0008). */
function useRemotePeople(query: string): PersonHit[] {
  const [hits, setHits] = useState<{ q: string; rows: PersonHit[] }>({ q: '', rows: [] });
  useEffect(() => {
    if (repo.mode() !== 'real' || query.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      searchPeople(query)
        .then((rows) => live && setHits({ q: query, rows }))
        .catch(() => live && setHits({ q: query, rows: [] }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  return hits.q === query ? hits.rows : EMPTY_HITS;
}
const EMPTY_HITS: PersonHit[] = [];

const styles = StyleSheet.create({
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong, marginTop: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  input: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  text: { flex: 1, marginLeft: 8, fontSize: 16, color: colors.ink, height: 48 },
  cancel: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4 },
  thumb: { width: 48, height: 48, borderRadius: 12 },
});
