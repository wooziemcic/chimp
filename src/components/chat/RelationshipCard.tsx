import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { interestById } from '@/data/interests';
import { useMatch } from '@/hooks/useGraph';
import { repo } from '@/services/repository';
import { colors, radius } from '@/theme';
import { hrefFor } from '@/utils/links';

/**
 * Why this conversation exists: where you met, what you share and why Chimp
 * connected you. Makes chat part of the graph, not a generic DM.
 */
export function RelationshipCard({ personId, firstName, empty, onStarter }: { personId: string; firstName: string; empty: boolean; onStarter: (t: string) => void }) {
  const match = useMatch(personId);
  if (!match) return null;
  const met = match.metThrough;
  const metLabel = met ? repo.labelFor(met) : undefined;
  const metImage = met ? repo.imageFor(met) : undefined;
  return (
    <View style={styles.rel}>
      {met ? (
        <Tap onPress={() => router.push(hrefFor(met))} style={styles.relRow} accessibilityLabel={`You met through ${metLabel}`}>
          <Img uri={metImage} style={styles.relThumb} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <T v="caption" color={colors.inkFaint} weight="700" style={{ letterSpacing: 0.8 }}>
              YOU MET THROUGH
            </T>
            <T v="bodyStrong">{metLabel}</T>
          </View>
        </Tap>
      ) : null}
      {match.sharedInterests.length ? (
        <View style={{ marginTop: 12 }}>
          <T v="caption" color={colors.inkFaint} weight="700" style={{ letterSpacing: 0.8 }}>
            SHARED
          </T>
          <View style={styles.relChips}>
            {match.sharedInterests.slice(0, 4).map((i) => (
              <View key={i} style={styles.relChip}>
                <T v="footnote" weight="600" color={colors.accent}>
                  {interestById[i]?.label}
                </T>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ marginTop: 12 }}>
        <T v="caption" color={colors.inkFaint} weight="700" style={{ letterSpacing: 0.8 }}>
          WHY CHIMP CONNECTED YOU
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Sparkles size={14} color={colors.accent} />
          <T v="subhead" weight="600" color={colors.ink2} style={{ marginLeft: 6, flex: 1 }}>
            {match.matchReasons[0]?.label ?? 'You’re in each other’s graph'}
          </T>
        </View>
      </View>
      {empty ? (
        <>
          <T v="title3" align="center" style={{ marginTop: 18 }}>
            {`Say hi to ${firstName}.`}
          </T>
          {match.openers.length ? (
            <View style={{ marginTop: 10, gap: 6 }}>
              <T v="caption" color={colors.inkFaint} weight="700" align="center" style={{ letterSpacing: 0.8 }}>
                START FROM SOMETHING YOU SHARE
              </T>
              {match.openers.map((o) => (
                <Tap key={o.draft} onPress={() => onStarter(o.draft)} style={styles.starter} accessibilityLabel={`Use: ${o.draft}`}>
                  <T v="caption" weight="700" color={colors.accent}>
                    {o.context}
                  </T>
                  <T v="footnote" weight="500" color={colors.ink2} style={{ marginTop: 1 }}>
                    {o.draft}
                  </T>
                </Tap>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rel: { padding: 16, borderRadius: radius.xl, backgroundColor: colors.surface, marginBottom: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  relRow: { flexDirection: 'row', alignItems: 'center' },
  relThumb: { width: 48, height: 48, borderRadius: 12 },
  starter: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.surfaceMuted },
  relChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  relChip: { height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.accentSoft, justifyContent: 'center' },
});
