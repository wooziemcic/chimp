import { router } from 'expo-router';
import { Camera, CircleDashed, Globe2, MessageSquarePlus } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { SheetHeader } from '@/components/ui/SheetHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { colors, radius } from '@/theme';

const OPTIONS = [
  { href: '/create/buzz', title: 'Buzz', body: 'A thought, a photo or a poll. A World is optional.', Icon: MessageSquarePlus },
  { href: '/create/drift', title: 'Photos in a World', body: 'A photo or a set, shared into a World. Shows in Happening.', Icon: Camera },
  { href: '/create/story', title: 'Story', body: 'A photo for 24 hours, yours or in a World.', Icon: CircleDashed },
  { href: '/create/world', title: 'New World', body: 'Start a Board: a trip, a scene, a plan.', Icon: Globe2 },
] as const;

/** One place to make things. Everything you make belongs to a World. */
export default function CreateSheet() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <SheetHeader title="Create" />
      <View style={{ padding: 16, gap: 10 }}>
        {OPTIONS.map(({ href, title, body, Icon }) => (
          <Tap key={href} onPress={() => router.replace(href)} style={styles.row} accessibilityLabel={title}>
            <View style={styles.icon}>
              <Icon size={22} color={colors.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <T v="bodyStrong">{title}</T>
              <T v="footnote" color={colors.inkMuted} weight="400">
                {body}
              </T>
            </View>
          </Tap>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  icon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
