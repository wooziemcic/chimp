import { CornerUpLeft } from 'lucide-react-native';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import type { ChatMsg } from '@/store/useChat';
import { openMedia } from '@/store/useMediaViewer';
import { colors } from '@/theme';
import type { ImageSrc } from '@/types/models';
import { clockLabel } from '@/utils/format';
import { type Receipt, receiptLabel } from '@/utils/receipts';
import type { ReactionChip } from '@/utils/messaging';

interface Props {
  m: ChatMsg;
  mine: boolean;
  /** Groups: who said it (shown on the first bubble of a run). */
  sender?: { name: string; avatar?: ImageSrc; first: boolean; last: boolean };
  /** The message this one replies to, resolved. */
  quote?: { name: string; text: string } | null;
  reactions: ReactionChip[];
  onLongPress: (m: ChatMsg) => void;
  onRetry: () => void;
  onToggleReaction: (emoji: string) => void;
  /**
   * Phase 8: Sent / Delivered / Seen — only on my newest message (one status
   * line per chat). Groups show "Seen by N"; tapping it says who.
   */
  receipt?: Receipt | null;
  onReceiptPress?: () => void;
}

/**
 * One message. Long-press opens the message menu (Reply, React, Turn into
 * Open Loop, Copy, Delete if yours). Reactions sit under the bubble with real
 * counts; a Same Brain is marked "⚡ Same Brain" once, next to its emoji.
 */
export const ChatBubble = memo(function ChatBubble({ m, mine, sender, quote, reactions, onLongPress, onRetry, onToggleReaction, receipt, onReceiptPress }: Props) {
  const failed = m.status === 'failed';
  const pending = !!m.status;
  const group = !!sender;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      {group && !mine ? (
        <View style={{ width: 30, marginRight: 6 }}>{sender.last ? <Avatar uri={sender.avatar} name={sender.name} size={28} /> : null}</View>
      ) : null}
      <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: group && !mine ? '82%' : '100%', flexShrink: 1 }}>
        {group && !mine && sender.first ? (
          <T v="caption" color={colors.inkMuted} style={{ marginLeft: 12, marginBottom: 2 }} numberOfLines={1}>
            {sender.name}
          </T>
        ) : null}
        <Tap
          onLongPress={() => onLongPress(m)}
          delayLongPress={320}
          haptic={false}
          scaleTo={0.985}
          onPress={m.image ? () => openMedia([m.image!], m.aspect ? [m.aspect] : undefined, 0) : undefined}
          style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}
          accessibilityLabel={`${mine ? 'You' : sender?.name ?? 'Them'}: ${m.body ?? 'Photo'}`}
          accessibilityHint="Long-press for Reply, React, Open Loop, Copy"
          testID={`msg-${m.body ?? m.id}`}
        >
          {quote ? (
            <View style={[styles.quote, mine ? { alignSelf: 'flex-end' } : null]}>
              <CornerUpLeft size={12} color={colors.inkFaint} />
              <T v="caption" color={colors.inkMuted} numberOfLines={1} style={{ marginLeft: 4, flexShrink: 1 }}>
                {`${quote.name}: ${quote.text}`}
              </T>
            </View>
          ) : null}
          {m.image ? <Img uri={m.image} style={{ width: 220, height: Math.round(220 / Math.min(1.6, Math.max(0.7, m.aspect ?? 1))), borderRadius: 18, opacity: m.status === 'sending' ? 0.6 : 1 }} /> : null}
          {m.body ? (
            <View style={[styles.bubble, mine ? styles.mine : styles.theirs, failed && styles.failed, m.image && { marginTop: 4 }]}>
              <T v="subhead" weight="400" color={mine && !failed ? colors.white : colors.ink}>
                {m.body}
              </T>
            </View>
          ) : null}
        </Tap>
        {reactions.length && !pending ? (
          <View style={[styles.reactions, mine ? { justifyContent: 'flex-end' } : null]}>
            {reactions.map((r) => (
              <Tap
                key={r.emoji}
                onPress={() => onToggleReaction(r.emoji)}
                scaleTo={0.9}
                style={[styles.chip, r.mine && styles.chipMine, r.sameBrain && styles.chipBrain]}
                accessibilityLabel={`${r.emoji} ${r.count}${r.sameBrain ? ', Same Brain' : ''}${r.mine ? ', you reacted' : ''}`}
                testID={`reaction-${r.emoji}`}
              >
                <T v="footnote" style={{ fontSize: 13 }}>{`${r.emoji} ${r.count > 1 || r.sameBrain ? `× ${r.count}` : ''}`.trim()}</T>
                {r.sameBrain ? (
                  <T v="caption" weight="800" color={colors.violet} style={{ marginLeft: 5 }}>
                    ⚡ Same Brain
                  </T>
                ) : null}
              </Tap>
            ))}
          </View>
        ) : null}
        {failed ? (
          <Tap onPress={onRetry} style={{ marginTop: 3 }} accessibilityLabel="Not sent. Tap to retry">
            <T v="caption" color={colors.danger} weight="700">
              Not sent · Tap to retry
            </T>
          </Tap>
        ) : receipt && receipt.kind === 'seenBy' && onReceiptPress ? (
          <Tap onPress={onReceiptPress} hitSlop={10} style={{ marginTop: 2, minHeight: 22, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={`${receiptLabel(receipt)}. Show who`} testID="receipt">
            <T v="caption" color={colors.inkFaint} style={{ fontSize: 11 }}>
              {`${clockLabel(m.createdAt)} · `}
              <T v="caption" weight="700" color={colors.inkMuted} style={{ fontSize: 11 }}>
                {receiptLabel(receipt)}
              </T>
            </T>
          </Tap>
        ) : !group || mine || sender?.last ? (
          <T v="caption" color={colors.inkFaint} style={{ marginTop: 2, fontSize: 11, marginHorizontal: group && !mine ? 12 : 0 }} testID={receipt ? 'receipt' : undefined}>
            {m.status === 'sending' ? 'Sending…' : receipt ? `${clockLabel(m.createdAt)} · ${receiptLabel(receipt)}` : clockLabel(m.createdAt)}
          </T>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, maxWidth: 300 },
  mine: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 6 },
  failed: { backgroundColor: '#FFF1F1', borderWidth: 1, borderColor: '#F7B4B4' },
  quote: { flexDirection: 'row', alignItems: 'center', maxWidth: 260, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 3, borderRadius: 12, backgroundColor: colors.surfaceMuted, borderLeftWidth: 3, borderLeftColor: colors.lineStrong },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, maxWidth: 280 },
  chip: { flexDirection: 'row', alignItems: 'center', height: 26, paddingHorizontal: 8, borderRadius: 13, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  chipMine: { backgroundColor: colors.accentSoft, borderColor: colors.accentGlow },
  chipBrain: { backgroundColor: colors.violetSoft, borderColor: '#D9C9FF' },
});
