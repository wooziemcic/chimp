import { CornerDownRight, X } from 'lucide-react-native';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { colors } from '@/theme';

/**
 * Phase 9.2: the small pieces threaded comments share (Buzz replies and the
 * comments sheet): indentation with a tappable thread line (collapse), the
 * Reply / "N replies" line, the ••• slot, and the "Replying to …" bar over
 * the composer. Comments have no likes or votes.
 */

const INDENT = 22;
/** The tappable strip around the thread line (the line itself stays 2 pt):
 *  12 pt to its left, 10 to its right, plus a little hitSlop into the empty margin. */
const LINE_LEFT = 12;
const LINE_HIT = 24;

/**
 * A reply, indented under its parent with the thread line on its left.
 * Phase 9.2 follow-up: tapping the line collapses the parent's whole branch
 * (Reddit-style); nothing else in the row is affected.
 */
export function ThreadIndent({ depth, children, onCollapse, parentName }: { depth: number; children: ReactNode; onCollapse?: () => void; parentName?: string }) {
  if (!depth) return <>{children}</>;
  return (
    // The line sits exactly where it did (14 pt in), the text starts where it did;
    // only the invisible touch strip around the line is wider.
    <View style={{ flexDirection: 'row', marginLeft: (depth - 1) * INDENT + 14 - LINE_LEFT }} testID={`thread-depth-${depth}`}>
      <Tap
        onPress={onCollapse}
        disabled={!onCollapse}
        scaleTo={1}
        hitSlop={{ top: 0, bottom: 0, left: 8, right: 0 }}
        style={styles.lineHit}
        accessibilityLabel={parentName ? `Collapse replies to ${parentName}` : 'Collapse replies'}
        testID="thread-line"
      >
        <View style={styles.line} />
      </Tap>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

/**
 * The non-interactive part of a comment (name, time, text). When the comment
 * has replies, tapping it collapses / expands that comment's own branch;
 * otherwise it's plain content. Reply, •••, the avatar and links sit outside it.
 */
export function ThreadBody({ replies, collapsed, onToggle, label, children }: { replies: number; collapsed: boolean; onToggle: () => void; label: string; children: ReactNode }) {
  if (!replies) return <View>{children}</View>;
  return (
    <Tap onPress={onToggle} scaleTo={1} accessibilityLabel={`${label}. ${collapsed ? `Show ${replies} ${replies === 1 ? 'reply' : 'replies'}` : 'Collapse replies'}`} testID={collapsed ? 'comment-body-expand' : 'comment-body-collapse'}>
      {children}
    </Tap>
  );
}

/** Keeps a comment's ••• at the top-right of its card, level with the name and time. */
export function ThreadMenuSlot({ children }: { children: ReactNode }) {
  return <View style={styles.menuSlot}>{children}</View>;
}

/** "Reply", and on a collapsed comment a quiet "N replies" that opens the branch again. */
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
      {replies && collapsed ? (
        <Tap onPress={onToggle} hitSlop={8} style={[styles.action, styles.collapsed]} accessibilityLabel={`Show ${replies} ${replies === 1 ? 'reply' : 'replies'}`} testID="thread-toggle">
          <View style={styles.collapsedLine} />
          <T v="caption" weight="700" color={colors.accent}>
            {`${replies} ${replies === 1 ? 'reply' : 'replies'}`}
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
  lineHit: { width: LINE_HIT, paddingLeft: LINE_LEFT, alignItems: 'flex-start' },
  line: { width: 2, flex: 1, borderRadius: 1, backgroundColor: colors.line },
  menuSlot: { alignSelf: 'flex-start', marginTop: -8, marginRight: -6 },
  collapsed: { flexDirection: 'row', alignItems: 'center' },
  collapsedLine: { width: 2, height: 14, borderRadius: 1, backgroundColor: colors.accent, marginRight: 6, opacity: 0.6 },
  action: { minHeight: 28, justifyContent: 'center', marginRight: 16 },
  replying: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
});
