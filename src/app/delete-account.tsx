import { router } from 'expo-router';
import { AlertTriangle, Globe2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/misc';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { T } from '@/components/ui/Text';
import { useKeyboardHeight } from '@/hooks/useKeyboard';
import { type DeletionPreview, fetchDeletionPreview } from '@/services/backend/auth';
import { useSession } from '@/store/useSession';
import { colors, radius } from '@/theme';

const CONFIRM = 'DELETE';

const GOES = [
  'Your profile, @username, photo and Open To',
  'Your Buzz posts, Drift videos, Stories and comments',
  'Your likes, saves, votes, follows, connections and Crushes',
  'Your chats (the whole conversation, for both people)',
  'Photos and videos you uploaded',
];

/**
 * Settings → Delete account (Phase 6D). Says what happens, shows the Worlds
 * you own, asks you to type DELETE, then the server deletes the account
 * (Edge Function: it can only ever delete the signed-in caller). Afterwards
 * this phone forgets the account and returns to Welcome. The email and the
 * @username are free again: signing up later makes a brand-new account.
 */
export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const mode = useSession((s) => s.mode);
  const email = useSession((s) => s.email);
  const deleteAccount = useSession((s) => s.deleteAccount);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (mode !== 'real') return;
    let live = true;
    fetchDeletionPreview()
      .then((p) => live && setPreview(p))
      .catch((e) => live && setPreviewError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [mode]);

  const worlds = preview?.worlds ?? [];
  const shared = worlds.filter((w) => w.others > 0);
  const ready = typed.trim().toUpperCase() === CONFIRM && !busy;

  const go = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(transfer && shared.length > 0);
      // The session is gone: the app has already switched back to Welcome.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (mode !== 'real') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <SheetHeader title="Delete account" />
        <T v="subhead" color={colors.inkMuted} weight="400" style={{ padding: 20 }}>
          The Demo account lives only on this phone. Leave it from Settings instead.
        </T>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingBottom: kb > 0 ? kb : 0 }}>
      <SheetHeader title="Delete account" subtitle={email ?? undefined} />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ padding: 20, paddingBottom: 24 + (kb > 0 ? 0 : insets.bottom) }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.warn}>
          <AlertTriangle size={20} color={colors.danger} />
          <T v="subhead" color={colors.ink} style={{ marginLeft: 10, flex: 1 }}>
            This permanently deletes your Chimp account. It can’t be undone.
          </T>
        </View>

        <T v="label" color={colors.inkFaint} style={styles.label}>
          WHAT’S DELETED
        </T>
        {GOES.map((line) => (
          <View key={line} style={styles.bullet}>
            <View style={styles.dot} />
            <T v="subhead" weight="400" color={colors.ink2} style={{ flex: 1 }}>
              {line}
            </T>
          </View>
        ))}
        <T v="footnote" weight="400" color={colors.inkMuted} style={{ marginTop: 8 }}>
          Replies and likes other people left on your posts go with them. Posts you made inside Worlds that stay are deleted too. Your email and @username become free: signing up again later creates a brand-new, empty account.
        </T>

        <T v="label" color={colors.inkFaint} style={styles.label}>
          WORLDS YOU OWN
        </T>
        {!preview && !previewError ? <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start' }} /> : null}
        {previewError ? (
          <T v="footnote" color={colors.inkMuted} weight="400">
            {`Couldn’t load your Worlds (${previewError}). Deleting still removes any World you own.`}
          </T>
        ) : null}
        {preview && worlds.length === 0 ? (
          <T v="subhead" color={colors.inkMuted} weight="400">
            You don’t own any Worlds.
          </T>
        ) : null}
        {worlds.map((w) => (
          <View key={w.id} style={styles.world}>
            <Globe2 size={18} color={colors.inkMuted} />
            <T v="bodyStrong" style={{ flex: 1, marginLeft: 10 }} numberOfLines={1}>
              {w.title}
            </T>
            <T v="footnote" color={colors.inkMuted} weight="400">
              {w.others === 0 ? 'Just you' : `${w.others} other ${w.others === 1 ? 'member' : 'members'}`}
            </T>
          </View>
        ))}
        {shared.length > 0 ? (
          <View style={styles.transfer}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <T v="bodyStrong">Hand them on instead</T>
              <T v="footnote" color={colors.inkMuted} weight="400">
                {transfer
                  ? 'Worlds with other members go to their longest-standing member (admins first). Worlds with only you are deleted.'
                  : 'Off: every World you own is deleted, with its posts, for everyone.'}
              </T>
            </View>
            <Switch value={transfer} onValueChange={setTransfer} accessibilityLabel="Hand my Worlds on to a member" testID="delete-transfer" />
          </View>
        ) : null}

        <T v="label" color={colors.inkFaint} style={styles.label}>
          CONFIRM
        </T>
        <T v="subhead" weight="400" color={colors.ink2}>
          {`Type ${CONFIRM} to confirm.`}
        </T>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          onFocus={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 300)}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          placeholder={CONFIRM}
          placeholderTextColor={colors.inkFaint}
          style={styles.input}
          accessibilityLabel={`Type ${CONFIRM} to confirm`}
          testID="delete-confirm-input"
        />
        {error ? (
          <T v="subhead" color={colors.danger} weight="500" style={{ marginTop: 12 }} testID="delete-error">
            {error}
          </T>
        ) : null}
        {busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20 }}>
            <ActivityIndicator color={colors.danger} />
            <T v="subhead" color={colors.inkMuted} style={{ marginLeft: 10 }}>
              Deleting your account…
            </T>
          </View>
        ) : (
          <Button label="Delete my account permanently" size="lg" color={colors.danger} disabled={!ready} onPress={() => void go()} style={{ marginTop: 20, opacity: ready ? 1 : 0.4 }} />
        )}
        <Button label="Cancel" variant="ghost" color={colors.ink2} onPress={() => router.back()} style={{ marginTop: 8 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  warn: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.lg, backgroundColor: '#FEF3F2', borderWidth: 1, borderColor: '#FECDCA' },
  label: { marginTop: 22, marginBottom: 8 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger, marginTop: 8, marginRight: 10 },
  world: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: radius.lg, backgroundColor: colors.bg, marginBottom: 6 },
  transfer: { flexDirection: 'row', alignItems: 'center', marginTop: 8, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  input: { marginTop: 10, height: 50, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.lineStrong, paddingHorizontal: 14, fontSize: 18, fontWeight: '700', letterSpacing: 2, color: colors.ink },
});
