import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Send } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RealChat } from '@/components/chat/RealChat';
import { RelationshipCard } from '@/components/chat/RelationshipCard';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/misc';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { repo } from '@/services/repository';
import { useChimp } from '@/store/useChimp';
import { colors, radius } from '@/theme';
import type { ChatMessage } from '@/types/models';
import { useComposerNavSpace } from '@/hooks/useLayout';

const EMPTY: ChatMessage[] = [];

/**
 * 1:1 chat. Phase 6B: REAL accounts use real-time Supabase chat (RealChat);
 * the Demo account keeps its local chat with simulated replies.
 */
export default function ChatRoute() {
  const { id, draft } = useLocalSearchParams<{ id: string; draft?: string }>();
  if (repo.mode() === 'real') return <RealChat personId={id} draft={draft} />;
  return <DemoChat />;
}

/** Demo chat: messages persist locally and replies are simulated (fixture people only). */
function DemoChat() {
  const { id, draft } = useLocalSearchParams<{ id: string; draft?: string }>();
  const user = repo.user(id);
  const messages = useChimp((s) => s.chats[id]) ?? EMPTY;
  const send = useChimp((s) => s.sendMessage);
  const receive = useChimp((s) => s.receiveMessage);
  const [text, setText] = useState(draft ?? '');
  const navSpace = useComposerNavSpace();
  const list = useRef<FlatList<ChatMessage>>(null);
  const rec = repo.recFor(id);

  useEffect(() => {
    const t = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  if (!user) return <EmptyState title="Conversation not found" />;
  const first = user.displayName.split(' ')[0];

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    send(id, body);
    setText('');
    // DEMO only: fixture people "reply". A REAL person is never simulated (REAL uses RealChat).
    if (repo.mode() === 'demo' && messages.filter((m) => !m.fromMe).length < 2) {
      setTimeout(() => receive(id, messages.length === 0 ? `Hey! Good to connect 👋 ${rec ? 'Saw we overlap on a few things.' : ''}` : 'Sounds good. Let’s lock something in.'), 1400);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={colors.ink} />
        </IconButton>
        <Tap onPress={() => router.push(`/profile/${user.id}`)} style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginLeft: 10 }}>
          <Avatar uri={user.avatar} name={user.displayName} size={40} />
          <View style={{ marginLeft: 10 }}>
            <T v="bodyStrong">{user.displayName}</T>
            <T v="caption" color={colors.inkMuted} weight="500">
              {user.city}
            </T>
          </View>
        </Tap>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
          keyboardDismissMode="interactive"
          ListHeaderComponent={<RelationshipCard personId={user.id} firstName={first} empty={messages.length === 0} onStarter={setText} />}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.fromMe ? styles.mine : styles.theirs]}>
              <T v="subhead" weight="400" color={item.fromMe ? colors.white : colors.ink}>
                {item.body}
              </T>
            </View>
          )}
        />
        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Message ${first}…`}
            placeholderTextColor={colors.inkFaint}
            style={styles.input}
            multiline
            maxLength={1000}
          />
          <Tap onPress={submit} disabled={!text.trim()} haptic="light" style={[styles.send, !text.trim() && { opacity: 0.4 }]} accessibilityLabel="Send message">
            <Send size={18} color={colors.white} />
          </Tap>
        </View>
        {/* Build 5 patch: room for the shared bottom bar (0 while the keyboard is up). */}
        <View style={{ height: navSpace }} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  context: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: radius.md, backgroundColor: colors.accentSoft, marginBottom: 10 },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 6 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.bg },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    color: colors.ink,
  },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});
