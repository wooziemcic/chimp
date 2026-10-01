import { Caveat_600SemiBold, Caveat_700Bold, useFonts } from '@expo-google-fonts/caveat';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppReviewFrame } from '@/components/AppReviewBanner';
import { AUTH_BG } from '@/components/auth/palette';
import { MediaViewer } from '@/components/media/MediaViewer';
import { T } from '@/components/ui/Text';
import { isBackendConfigured } from '@/lib/supabase';
import { useChat } from '@/store/useChat';
import { realChatApi } from '@/services/chatApi';
import { demoChatApi } from '@/services/demoChat';
import { ME_ID } from '@/data/users';
import { useChimp } from '@/store/useChimp';
import { useSession } from '@/store/useSession';
import { colors } from '@/theme';
import { afterFirstPaint, startupMark } from '@/utils/startup';

SplashScreen.preventAutoHideAsync().catch(() => {});

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.accent, card: colors.surface },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Caveat_600SemiBold, Caveat_700Bold });
  const hydrated = useChimp((s) => s.hydrated);
  const status = useSession((s) => s.status);
  const appReady = status === 'ready';
  // App Review Demo: a banner with "Exit App Review Demo" above every screen.
  const reviewDemo = useSession((s) => s.reviewDemo && s.mode === 'demo');
  const ready = (fontsLoaded || !!fontError) && hydrated && status !== 'booting';

  // Phase 6A: decide DEMO vs REAL, restore the Supabase session.
  useEffect(() => {
    if (!hydrated) return;
    startupMark('store hydrated');
    if (useSession.getState().status === 'booting') void useSession.getState().boot();
  }, [hydrated]);
  useEffect(() => {
    if (fontsLoaded || fontError) startupMark('fonts ready');
  }, [fontsLoaded, fontError]);

  // Phase 6B: real-time chat runs while a REAL account is signed in (torn down on any account change).
  const mode = useSession((s) => s.mode);
  const uid = useSession((s) => s.uid);
  // Phase 6C: started after Buzz has painted, so it never competes with the first screen.
  // Final messaging patch: the Demo account gets its own in-memory chat backend (never Supabase).
  useEffect(() => {
    if (!appReady) return;
    const which = mode === 'real' && uid && isBackendConfigured ? { uid, api: realChatApi } : mode === 'demo' ? { uid: ME_ID, api: demoChatApi } : null;
    if (!which) return;
    const cancel = afterFirstPaint(() => {
      startupMark('chat started (deferred)');
      void useChat.getState().start(which.uid, which.api);
    });
    return () => {
      cancel();
      useChat.getState().stop();
    };
  }, [appReady, mode, uid]);

  // Re-entry loop: the world moves on while you are away.
  useEffect(() => {
    if (!hydrated || !appReady) return;
    // Phase 6C: after the first paint (it can recompute a lot of the local graph).
    const cancel = afterFirstPaint(() => useChimp.getState().advanceWorld(Date.now()), 2000);
    const sub = AppState.addEventListener('change', (state) => {
      const store = useChimp.getState();
      if (state === 'active') store.advanceWorld(Date.now());
      else if (state === 'background') store.noteLeaving(Date.now());
    });
    return () => {
      cancel();
      sub.remove();
    };
  }, [hydrated, appReady]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  // Phase 6B: during an account change nothing of the app is mounted, so no
  // screen can render against a half-swapped store/dataset. The navigator
  // remounts fresh afterwards (gate → Buzz or Welcome).
  if (status === 'switching') return <SwitchingScreen />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemeProvider value={navTheme}>
        <AppReviewFrame active={reviewDemo && appReady}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          {/* Phase 6A gate: `/` routes by session status (see app/index.tsx). */}
          <Stack.Screen name="index" />
          <Stack.Protected guard={!appReady}>
            <Stack.Screen name="(auth)" options={{ contentStyle: { backgroundColor: AUTH_BG } }} />
          </Stack.Protected>
          <Stack.Protected guard={appReady}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="board/[id]" />
          <Stack.Screen name="move/[id]" />
          <Stack.Screen name="profile/[id]" />
          <Stack.Screen name="route/[id]" />
          <Stack.Screen name="after-dark/[section]" options={{ contentStyle: { backgroundColor: '#07060A' } }} />
          <Stack.Screen name="people" />
          <Stack.Screen name="agent" />
          <Stack.Screen name="loops" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="graph-debug" />
          <Stack.Screen name="buzz/[id]" />
          <Stack.Screen name="drift/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="messages" />
          {/* Final messaging patch: group chats. */}
          <Stack.Screen name="group/[id]" />
          <Stack.Screen name="group-info/[id]" />
          <Stack.Screen name="new-group" options={{ presentation: 'modal' }} />
          <Stack.Screen name="group-add/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen
            name="story/[id]"
            options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#000' } }}
          />
          <Stack.Screen name="search" options={{ presentation: 'modal' }} />
          <Stack.Screen name="delta" options={{ presentation: 'modal' }} />
          <Stack.Screen name="comments/[postId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="age-gate" options={{ presentation: 'transparentModal', animation: 'fade' }} />
          <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
          <Stack.Screen name="new-chat" options={{ presentation: 'modal' }} />
          <Stack.Screen name="create/index" options={{ presentation: 'modal' }} />
          <Stack.Screen name="create/buzz" options={{ presentation: 'modal' }} />
          <Stack.Screen name="create/drift" options={{ presentation: 'modal' }} />
          <Stack.Screen name="create/story" options={{ presentation: 'modal' }} />
          <Stack.Screen name="create/world" options={{ presentation: 'modal' }} />
          {/* Phase 6D */}
          <Stack.Screen name="delete-account" options={{ presentation: 'modal' }} />
          <Stack.Screen name="edit-buzz/[id]" options={{ presentation: 'modal' }} />
          </Stack.Protected>
        </Stack>
        {/* Phase 6B: one global media viewer (a modal, not a route). */}
        {appReady ? <MediaViewer /> : null}
        </AppReviewFrame>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function SwitchingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: AUTH_BG, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Switching account">
      <ActivityIndicator color="#FF6B61" />
      <T style={{ color: '#B9B4D6', fontSize: 15, marginTop: 12 }}>One moment…</T>
    </View>
  );
}
