import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThreadCard } from '@/components/afterdark/NightParts';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { Img } from '@/components/ui/Img';
import { T } from '@/components/ui/Text';
import { NIGHT_SECTIONS } from '@/data/afterDark';
import { useChimp } from '@/store/useChimp';
import { repo } from '@/services/repository';

/** A section inside After Dark (Confessions, Rooftops, …). */
export default function NightSectionScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const insets = useSafeAreaInsets();
  const t = repo.nightBoard().theme;
  const all = repo.nightThreads();
  const ageConfirmed = useChimp((s) => s.afterDark.ageConfirmed);
  const sec = NIGHT_SECTIONS.find((s) => s.id === section) ?? NIGHT_SECTIONS[0];
  const threads = all.filter((t) => t.section === sec.id);
  const others = all.filter((t) => t.section !== sec.id);

  if (!ageConfirmed) return <Redirect href="/after-dark" />;

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <View style={{ height: 250 + insets.top }}>
          <Img uri={sec.image} tint={t.surface} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(7,6,10,0.5)', 'rgba(90,8,40,0.3)', t.background]} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', top: insets.top + 6, left: 16 }}>
            <IconButton label="Back" variant="dark" onPress={() => router.back()}>
              <ChevronLeft size={24} color="#fff" />
            </IconButton>
          </View>
          <View style={{ position: 'absolute', left: 20, right: 20, bottom: 12 }}>
            <T v="title1" color={t.text}>
              {sec.title}
            </T>
            <T v="subhead" color={t.mutedText}>
              {sec.subtitle}
            </T>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 12 }}>
          {NIGHT_SECTIONS.map((s) => (
            <Chip key={s.id} label={s.title.split(' ')[0]} size="sm" tone="dark" activeColor={(t.secondary ?? t.primary)} active={s.id === sec.id} onPress={() => router.setParams({ section: s.id })} />
          ))}
        </ScrollView>
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {(threads.length ? threads : others).map((th) => (
            <ThreadCard key={th.id} thread={th} theme={t} />
          ))}
          {!all.length ? (
            <View style={{ padding: 16, borderRadius: 18, borderWidth: 1, borderColor: t.line }}>
              <T v="subhead" weight="700" color={t.text}>
                Nothing here yet
              </T>
              <T v="footnote" color={t.mutedText} style={{ marginTop: 4 }}>
                {`${sec.title} fills up as people join After Dark.`}
              </T>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
