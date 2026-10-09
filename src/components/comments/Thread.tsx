import { CornerDownRight, X } from 'lucide-react-native';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { colors } from '@/theme';

/**
 * Phase 9.2: the small pieces threaded comments share (Buzz replies and the
 * comments sheet): indentation, the Reply / show-hide line, and the
 * "Replying to …" bar over the composer. Comments have no likes or votes.
 */

const INDENT = 22;

export function ThreadIndent({ depth, children }: { depth: number; children: ReactNode }) {
  if (!depth) return <>{children}</>;
  return (
    <View style={{ marginLeft: (depth - 1) * INDENT + 14, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: colors.line }} testID={`thread-depth-${depth}`}>
      {children}
    </View>
  );
}

/** "Reply" and, when it has replies, "Hide replies" / "View N replies". */
export function ThreadActions({ onReply, replies, collapsed, onToggle, replyTo }: { onReply?: () => void; replies: number; collapsed: boolean; onToggle: () => void; replyTo?: string }) {
  return (
    <View style={styles.actions}>
      {replyTo ? (
        <T v="caption" color={colors.inkFaint} weight="500" numberOfLines={1} style={{ marginRight: 14, flexShrink: 1 }}>
          {`↳ ${replyTo}`}
        </T>
      ) : null}
      {onReply ? (
        <Tap onPress={onReply} hitSlop={8} style={styles.action} accessibilityLabel="Reply" testID="comment-reply">
          <T v="caption" weight="700" color={colors.inkMuted}>
            Reply
          </T>
        </Tap>
      ) : null}
      {replies ? (
        <Tap onPress={onToggle} hitSlop={8} style={styles.action} accessibilityLabel={collapsed ? `View ${replies} ${replies === 1 ? 'reply' : 'replies'}` : 'Hide replies'} testID="thread-toggle">
          <T v="caption" weight="700" color={colors.accent}>
            {collapsed ? `View ${replies} ${replies === 1 ? 'reply' : 'replies'}` : 'Hide replies'}
          </T>
        </Tap>
      ) : null}
    </View>
  );
}

export function ReplyingTo({ name, onCancel }: { name: string; onCancel: () => void }) {
  return (
    <View style={styles.replying} testID="replying-to">
      <CornerDownRight size={14} color={colors.accent} />
      <T v="footnote" weight="700" color={colors.accent} numberOfLines={1} style={{ flex: 1, marginLeft: 6 }}>
        {`Replying to ${name}`}
      </T>
      <Tap onPress={onCancel} style={{ padding: 6 }} accessibilityLabel="Cancel reply">
        <X size={16} color={colors.inkMuted} />
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  action: { minHeight: 28, justifyContent: 'center', marginRight: 16 },
  replying: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
});
