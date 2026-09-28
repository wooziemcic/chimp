import { router, useLocalSearchParams } from 'expo-router';
import { Bookmark, ChevronLeft, Footprints, Navigation } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RouteMap } from '@/components/boards/PostModules';
import { IconButton } from '@/components/ui/IconButton';
import { Img } from '@/components/ui/Img';
import { Button, EmptyState } from '@/components/ui/misc';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius } from '@/theme';

/** Saved route detail. A schematic map keeps this Expo Go-friendly. */
export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const post = repo.post(id);
  const saved = useChimp((s) => !!s.savedPosts[id]);
  const toggleSave = useChimp((s) => s.toggleSavePost);

  if (!post?.route) return <EmptyState title="Route not found" />;
  const board = repo.board(post.boardId)!;
  const route = post.route;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.top}>
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={colors.ink} />
        </IconButton>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <T v="caption" color={board.theme.primary} style={{ letterSpacing: 0.8 }}>
            {`SAVED ROUTE · ${board.title.toUpperCase()}`}
          </T>
          <T v="title3">{route.title}</T>
        </View>
        <IconButton label={saved ? 'Unsave route' : 'Save route'} onPress={() => toggleSave(id)}>
          <Bookmark size={20} color={saved ? board.theme.primary : colors.ink} fill={saved ? board.theme.primary : 'transparent'} />
        </IconButton>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <RouteMap post={post} theme={board.theme} height={280} />
        <View style={styles.stats}>
          <Stat label="Stops" value={`${route.stops.length}`} />
          <Stat label="Distance" value={`${route.distanceKm} km`} />
          <Stat label="Time" value={route.duration} />
        </View>
        <View style={{ marginTop: 8 }}>
          {route.stops.map((s, i) => (
            <View key={s.id} style={styles.stop}>
              <View style={styles.rail}>
                <View style={[styles.num, { backgroundColor: board.theme.primary }]}>
                  <T v="caption" color={colors.white}>
                    {i + 1}
                  </T>
                </View>
                {i < route.stops.length - 1 ? <View style={[styles.line, { backgroundColor: board.theme.primarySoft }]} /> : null}
              </View>
              <Img uri={s.image} style={styles.stopImg} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <T v="bodyStrong">{s.name}</T>
                <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginTop: 2 }}>
                  {s.note}
                </T>
              </View>
            </View>
          ))}
        </View>
        <Button
          label="Start walk"
          size="lg"
          color={board.theme.primary}
          icon={<Navigation size={18} color={colors.white} fill={colors.white} />}
          style={{ marginTop: 16 }}
          onPress={() => router.push(`/board/${board.id}`)}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
          <Footprints size={14} color={colors.inkFaint} />
          <T v="caption" color={colors.inkFaint} weight="500" style={{ marginLeft: 6 }}>
            Turn-by-turn navigation arrives with the maps integration.
          </T>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <T v="headline">{value}</T>
      <T v="caption" color={colors.inkMuted} weight="500">
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  stats: { flexDirection: 'row', marginTop: 14, paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.surface },
  stop: { flexDirection: 'row', alignItems: 'center', minHeight: 76 },
  rail: { width: 28, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' },
  num: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  line: { position: 'absolute', top: 50, bottom: -26, width: 3, borderRadius: 2 },
  stopImg: { width: 56, height: 56, borderRadius: 14, marginLeft: 8 },
});
