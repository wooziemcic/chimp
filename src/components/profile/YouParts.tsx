import { router } from 'expo-router';
import { ChevronRight, Heart, Link2, Sparkles, Users } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { OPEN_TO_LABEL } from '@/data/users';
import { repo } from '@/services/repository';
import { colors, radius, shadow } from '@/theme';
import type { OpenTo } from '@/types/models';

/**
 * Subtle dating layer on your own profile: what you're open to and,
 * only if there are any, your Sparks (mutual). Never Crush counts, never
 * who is secretly interested.
 */
export function DatingSummary({ openTo, sparks, onEdit }: { openTo: OpenTo[]; sparks: string[]; onEdit: () => void }) {
  const shown = openTo.filter((o) => o !== 'not_looking').slice(0, 4);
  return (
    <View style={styles.row}>
      <Tap onPress={onEdit} scaleTo={0.98} style={[styles.pill, { flex: 1 }]} accessibilityLabel="Open To">
        <T v="caption" color={colors.inkMuted} weight="800" style={{ letterSpacing: 0.8 }}>
          OPEN TO
        </T>
        <T v="subhead" weight="600" color={colors.ink} numberOfLines={1} style={{ marginTop: 1 }}>
          {openTo.includes('not_looking') ? 'Not looking right now' : shown.map((o) => OPEN_TO_LABEL[o].replace(' buddies', '')).join(' · ') || 'Not set'}
        </T>
      </Tap>
      {sparks.length ? (
        <Tap onPress={() => router.push(`/profile/${sparks[0]}`)} scaleTo={0.98} style={[styles.pill, styles.spark]} accessibilityLabel={`${sparks.length} Spark${sparks.length > 1 ? 's' : ''}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Heart size={13} color="#FF3D6E" fill="#FF3D6E" />
            <T v="caption" color="#D92D5A" weight="800" style={{ marginLeft: 4, letterSpacing: 0.8 }}>
              SPARKS
            </T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <T v="subhead" weight="800" color={colors.ink}>
              {sparks.length}
            </T>
            <View style={{ flexDirection: 'row', marginLeft: 6 }}>
              {sparks.slice(0, 3).map((id, i) => {
                const u = repo.user(id);
                return u ? (
                  <View key={id} style={{ marginLeft: i ? -6 : 0 }}>
                    <Avatar uri={u.avatar} name={u.displayName} size={20} />
                  </View>
                ) : null;
              })}
            </View>
          </View>
        </Tap>
      ) : null}
    </View>
  );
}

/** Connections / Matches entry points (the relationships you already have). */
export function RelationTiles({ connections, matches }: { connections: number; matches: number }) {
  return (
    <View style={[styles.row, { marginTop: 14 }]}>
      <Tile Icon={Link2} value={connections} label="Connections" sub="Plan together" onPress={() => router.push('/people?view=connections')} />
      <Tile Icon={Users} value={matches} label="Matches" sub="From your graph" onPress={() => router.push('/people')} />
    </View>
  );
}

/**
 * Phase 6C: the number and the word each get their own line, so "Connections"
 * never breaks ("Connectio / ns") in a half-width tile on an iPhone 12 — at
 * default text size or Larger Text (scaling is capped for these labels).
 */
function Tile({ Icon, value, label, sub, onPress }: { Icon: typeof Users; value: number; label: string; sub: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} scaleTo={0.98} style={[styles.tile, shadow.sm]} accessibilityLabel={`${value} ${label}. ${sub}`}>
      <View style={styles.tileTop}>
        <View style={styles.tileIcon}>
          <Icon size={16} color={colors.accent} />
        </View>
        <T v="title2" style={{ marginLeft: 10, flex: 1, fontSize: 24, lineHeight: 28 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
          {value}
        </T>
        <ChevronRight size={16} color={colors.inkFaint} />
      </View>
      <T v="subhead" weight="700" numberOfLines={1} maxFontSizeMultiplier={1.15} style={{ marginTop: 6 }}>
        {label}
      </T>
      <T v="caption" color={colors.inkMuted} weight="500" numberOfLines={1} maxFontSizeMultiplier={1.15} style={{ marginTop: 1 }}>
        {sub}
      </T>
    </Tap>
  );
}

/** "Into lately": what your graph has been leaning towards (live). */
export function Lately({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <View style={styles.lately}>
      <Sparkles size={14} color={colors.accent} />
      <T v="footnote" color={colors.ink2} style={{ marginLeft: 6, flex: 1 }}>
        <T v="footnote" weight="700" color={colors.accent}>
          Into lately{'  '}
        </T>
        {labels.join(' · ')}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  pill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.8)', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  spark: { backgroundColor: '#FFF1F4', borderColor: '#FFD1DC' },
  tile: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.xl, backgroundColor: colors.surface },
  tileTop: { flexDirection: 'row', alignItems: 'center' },
  tileIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  lately: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
});
