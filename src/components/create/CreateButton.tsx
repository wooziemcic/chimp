import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useMyAvatar } from '@/hooks/useGraph';
import { repo } from '@/services/repository';
import { colors, shadow } from '@/theme';

/** The blue "+" in page headers (opens a composer). */
export function CreateButton({ href, label = 'Create' }: { href: string; label?: string }) {
  return (
    <Tap onPress={() => router.push(href as never)} haptic="light" style={[styles.plus, shadow.glow]} accessibilityLabel={label}>
      <Plus size={24} color={colors.white} strokeWidth={2.6} />
    </Tap>
  );
}

/** "What's buzzing?" row at the top of Buzz. */
export function ComposeRow() {
  const avatar = useMyAvatar();
  return (
    <Tap onPress={() => router.push('/create/buzz')} style={styles.row} accessibilityLabel="Write a Buzz post">
      <Avatar uri={avatar} name={repo.me().displayName} size={36} />
      <T v="body" color={colors.inkFaint} style={{ marginLeft: 12, flex: 1 }}>
        What’s buzzing?
      </T>
      <View style={styles.mini}>
        <Plus size={16} color={colors.accent} strokeWidth={2.6} />
      </View>
    </Tap>
  );
}

/** "Your story" bubble at the start of Drift's stories. */
export function AddStoryBubble({ size = 64 }: { size?: number }) {
  const avatar = useMyAvatar();
  return (
    <Tap onPress={() => router.push('/create/story')} style={{ width: size + 18, alignItems: 'center', marginHorizontal: 4 }} accessibilityLabel="Add to your story">
      <View>
        <Avatar uri={avatar} name={repo.me().displayName} size={size} />
        <View style={styles.badge}>
          <Plus size={14} color={colors.white} strokeWidth={3} />
        </View>
      </View>
      <T v="caption" weight="600" numberOfLines={1} style={{ marginTop: 6 }}>
        Your story
      </T>
    </Tap>
  );
}

const styles = StyleSheet.create({
  plus: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginRight: 12, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, height: 56, paddingHorizontal: 12, borderRadius: 28, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  mini: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});
