import { router } from 'expo-router';
import { Bug, ChevronRight, EyeOff, FlaskConical, Globe, LogOut, Mail, RotateCcw, ShieldCheck, Trash2, VenetianMask } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { ME_ID, MY_PERSONAS } from '@/data/users';
import { demoChatApi, resetDemoChat } from '@/services/demoChat';
import { repo } from '@/services/repository';
import { useChat } from '@/store/useChat';
import { useChimp } from '@/store/useChimp';
import { useSession } from '@/store/useSession';
import { colors, radius } from '@/theme';
import type { IdentityMode } from '@/types/models';

const MODES: { id: IdentityMode; label: string; body: string; icon: ReactNode }[] = [
  { id: 'public', label: 'Public', body: 'Your name and profile are shown.', icon: <Globe size={18} color={colors.accent} /> },
  { id: 'pseudonymous', label: 'Verified pseudonym', body: 'A consistent alias. Verified by Chimp, not linked to your profile.', icon: <VenetianMask size={18} color={colors.accent} /> },
  { id: 'anonymous', label: 'Anonymous to members', body: 'No name shown. Still accountable to Chimp for safety.', icon: <EyeOff size={18} color={colors.accent} /> },
];

/**
 * Contextual identity: one private graph, different public faces per context
 * (research §5.4). Also the place to reset the local demo.
 */
export default function SettingsScreen() {
  const identity = useChimp((s) => s.identity);
  const setIdentity = useChimp((s) => s.setIdentity);
  const resetDemo = useChimp((s) => s.resetDemo);
  const mode = useSession((s) => s.mode);
  const email = useSession((s) => s.email);
  // Phase 6D: shown when the server says this account is a developer (or you're already in Demo).
  const developer = useSession((s) => s.developer);
  const signOut = useSession((s) => s.signOut);
  const enterDemo = useSession((s) => s.enterDemo);
  const demo = mode === 'demo';
  const contexts = [
    { id: 'default', title: 'Everywhere by default', allowed: ['public', 'pseudonymous'] as IdentityMode[] },
    { id: 'after-dark', title: 'After Dark', allowed: ['pseudonymous', 'anonymous'] as IdentityMode[] },
    ...(demo ? [{ id: 'boston-founders', title: 'Boston Founders', allowed: ['public', 'pseudonymous'] as IdentityMode[] }] : []),
  ];
  const pseudonym = MY_PERSONAS.find((p) => p.mode === 'pseudonymous')!.displayName;

  const reset = () =>
    Alert.alert('Reset demo data?', 'Joins, saves, votes, follows and your agent’s learning will return to the seeded state.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          resetDemo();
          // Final messaging patch: the Demo group chat starts over too.
          if (repo.mode() === 'demo') {
            resetDemoChat();
            useChat.getState().stop();
            void useChat.getState().start(ME_ID, demoChatApi);
          }
          router.back();
        },
      },
    ]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Identity & settings" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.intro}>
          <ShieldCheck size={20} color={colors.accent} />
          <T v="subhead" color={colors.ink2} weight="400" style={{ marginLeft: 10, flex: 1 }}>
            {demo
              ? `Your graph is private and unified. How you appear can differ by context. You are ${repo.me().username} in public and ${pseudonym} where you choose a pseudonym.`
              : `Your graph is private and unified. How you appear can differ by context. You are @${repo.me().username} in public and a verified pseudonym where you choose one.`}
          </T>
        </View>

        {contexts.map((c) => (
          <View key={c.id} style={styles.group}>
            <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
              {c.title.toUpperCase()}
            </T>
            {MODES.filter((m) => c.allowed.includes(m.id)).map((m) => {
              const on = (identity[c.id] ?? identity.default) === m.id;
              return (
                <Tap key={m.id} onPress={() => setIdentity(c.id, m.id)} haptic="select" style={[styles.option, on && styles.optionOn]}>
                  {m.icon}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <T v="bodyStrong">{m.label}</T>
                    <T v="footnote" color={colors.inkMuted} weight="400">
                      {m.body}
                    </T>
                  </View>
                  <View style={[styles.radio, on && styles.radioOn]} />
                </Tap>
              );
            })}
          </View>
        ))}

        <View style={styles.group}>
          <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
            PRIVATE ACTIVITY
          </T>
          <View style={styles.option}>
            <EyeOff size={18} color={colors.inkMuted} />
            <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginLeft: 12, flex: 1 }}>
              Saves, Open Loops and what your agent learns are only visible to you.
            </T>
          </View>
        </View>

        {/* ── Account (Phase 6A) ── */}
        <View style={styles.group}>
          <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
            ACCOUNT
          </T>
          <View style={styles.option}>
            <ShieldCheck size={18} color={colors.accent} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <T v="bodyStrong">{demo ? 'Demo account (WollyMc)' : `@${repo.me().username}`}</T>
              <T v="footnote" color={colors.inkMuted} weight="400">
                {demo ? 'Seeded test world. Nothing here is real or shared.' : developer ? 'Developer account' : 'Your Chimp account'}
              </T>
            </View>
          </View>
          {!demo && email ? (
            <View style={styles.option} testID="settings-email">
              <Mail size={18} color={colors.inkMuted} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <T v="bodyStrong">{email}</T>
                <T v="footnote" color={colors.inkMuted} weight="400">
                  You sign in with a code sent to this email.
                </T>
              </View>
            </View>
          ) : null}
          {demo ? (
            <Tap onPress={reset} style={styles.option}>
              <RotateCcw size={18} color={colors.danger} />
              <T v="bodyStrong" color={colors.danger} style={{ marginLeft: 12 }}>
                Reset demo data
              </T>
            </Tap>
          ) : null}
          <Tap onPress={() => void signOut()} style={styles.option} accessibilityLabel={demo ? 'Leave Demo' : 'Sign out'}>
            <LogOut size={18} color={colors.ink2} />
            <T v="bodyStrong" style={{ marginLeft: 12 }}>
              {demo ? 'Leave the Demo account' : 'Sign out'}
            </T>
          </Tap>
          {!demo ? (
            <Tap onPress={() => router.push('/delete-account')} style={styles.option} accessibilityLabel="Delete account" testID="settings-delete-account">
              <Trash2 size={18} color={colors.danger} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <T v="bodyStrong" color={colors.danger}>
                  Delete account
                </T>
                <T v="footnote" color={colors.inkMuted} weight="400">
                  Permanently removes your account and what you’ve posted.
                </T>
              </View>
              <ChevronRight size={18} color={colors.inkFaint} />
            </Tap>
          ) : null}
        </View>
        {developer || demo ? (
          <View style={styles.group} testID="settings-developer">
            <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
              DEVELOPER
            </T>
            {!demo ? (
              <Tap onPress={() => void enterDemo()} style={styles.option} accessibilityLabel="Enter Demo Account">
                <FlaskConical size={18} color={colors.inkMuted} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <T v="bodyStrong">Enter Demo Account</T>
                  <T v="footnote" color={colors.inkMuted} weight="400">
                    Opens WollyMc’s seeded test world. Leaving it brings you back here.
                  </T>
                </View>
              </Tap>
            ) : null}
            <Tap onPress={() => router.push('/graph-debug')} style={styles.option}>
              <Bug size={18} color={colors.inkMuted} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <T v="bodyStrong">Graph Debug</T>
                <T v="footnote" color={colors.inkMuted} weight="400">
                  Affinities, loops, change events and scores. Developer only.
                </T>
              </View>
              <ChevronRight size={18} color={colors.inkFaint} />
            </Tap>
          </View>
        ) : null}
        <T v="caption" color={colors.inkFaint} weight="500" align="center" style={{ marginTop: 18 }}>
          {demo ? 'Chimp prototype · Demo data stays on this device' : 'Chimp alpha · your account lives in Chimp’s backend'}
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', padding: 14, borderRadius: radius.lg, backgroundColor: colors.accentSoft },
  group: { marginTop: 20 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 8,
  },
  optionOn: { borderColor: colors.accent, backgroundColor: '#F7FAFF' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.lineStrong },
  radioOn: { borderColor: colors.accent, borderWidth: 7 },
});
