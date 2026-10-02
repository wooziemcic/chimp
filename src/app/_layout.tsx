import { Caveat_600SemiBold, Caveat_700Bold, useFonts } from '@expo-google-fonts/caveat';
import { DefaultTheme, type Href, router, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppReviewFrame } from '@/components/AppReviewBanner';
import { AUTH_BG } from '@/components/auth/palette';
import { MediaViewer } from '@/components/media/MediaViewer';
import { NestedTabBar } from '@/components/TabBar';
import { useKeyboardHeight } from '@/hooks/useKeyboard';
import { keepsBottomNav } from '@/hooks/useLayout';
import { T } from '@/components/ui/Text';
import { isBackendConfigured } from '@/lib/supabase';
import { useChat } from '@/store/useChat';
import { realChatApi } from '@/services/chatApi';
import { demoChatApi } from '@/services/demoChat';
import { realAfterDarkApi } from '@/services/afterDarkApi';
import { startLive, stopLive } from '@/services/live';
import { demoAfterDarkApi, setDemoAfterDarkContext } from '@/services/demoAfterDark';
import { useAfterDark } from '@/store/useAfterDark';
import { ME_ID } from '@/data/users';
import { useChimp } from '@/store/useChimp';
import { useExposure } from '@/store/useExposure';
import { ds } from '@/services/dataset';
import { startAnalytics } from '@/services/analytics';
import { ensurePushRegistered, installPushHandling, onPendingPush, pendingPush, takePendingPush } from '@/services/push';
import { OfflineBanner } from '@/components/OfflineBanner';
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
    const which =
      mode === 'real' && uid && isBackendConfigured
        ? { uid, api: realChatApi, ad: realAfterDarkApi }
        : mode === 'demo'
          ? { uid: ME_ID, api: demoChatApi, ad: demoAfterDarkApi }
          : null;
    if (!which) return;
    // Phase 7A: the Demo After Dark reads what the Demo world already knows (Worlds you joined, connections, Crushes, blocks).
    if (mode === 'demo') {
      const flags = (f: Record<string, unknown>) => Object.keys(f).filter((k) => f[k]);
      setDemoAfterDarkContext({
        joined: () => flags(useChimp.getState().joined),
        connections: () => Object.values(useChimp.getState().connections).filter((c) => c.status === 'connected').map((c) => c.userId),
        crushes: () => flags(useChimp.getState().crushes),
        blocked: () => flags(useChimp.getState().blocked),
      });
    }
    const cancel = afterFirstPaint(() => {
      startupMark('chat started (deferred)');
      void useChat.getState().start(which.uid, which.api);
      // Phase 7A: After Dark is bound to the same account, but loads nothing until it's opened.
      useAfterDark.getState().bind(which.uid, which.ad);
      // Phase 7B: relationship events + foreground / reconnect reconcile (REAL only; Demo never touches Supabase).
      if (!which.api.demo) startLive(which.uid);
    });
    return () => {
      cancel();
      stopLive();
      useChat.getState().stop();
      useAfterDark.getState().stop();
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

  // Phase 7C: notification taps and foreground presentation (installed once).
  useEffect(
    () =>
      installPushHandling(
        () => useChat.getState().activeId,
        () => useSession.getState().uid,
        () => {
          if (useSession.getState().mode === 'real') void ensurePushRegistered({ ask: 'never' });
        },
      ),
    [],
  );

  // Phase 7C: a signed-in REAL account registers this phone for pushes (asks
  // once, after the first screen has painted) and sends product events.
  // Demo / App Review Demo: neither (they never touch the network for this).
  useEffect(() => {
    if (!appReady || mode !== 'real' || !uid || !isBackendConfigured) return;
    startAnalytics();
    const cancel = afterFirstPaint(() => void ensurePushRegistered({ ask: 'once' }), 2500);
    return cancel;
  }, [appReady, mode, uid]);

  // Phase 7C: open what a tapped notification points at — only once the
  // session is restored, the right account is signed in and chat has started.
  useEffect(() => {
    if (!appReady) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const go = () => {
      const p = pendingPush();
      if (!p) return;
      const s = useSession.getState();
      if (s.mode !== 'real' || !s.uid || (p.for && p.for !== s.uid)) {
        takePendingPush(); // meant for another account (or the Demo is open): ignore
        return;
      }
      // Wait (up to 6 s) for chat / After Dark to be bound to this account.
      if (useChat.getState().uid !== s.uid && Date.now() - started < 6000) {
        timer = setTimeout(go, 250);
        return;
      }
      takePendingPush();
      router.push(p.target.href as Href);
    };
    go();
    const off = onPendingPush(go);
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [appReady, mode, uid]);

  // Phase 7C: a new "sitting" starts at launch, on every account change and on
  // coming back to the app; rankings then see what you were shown before it.
  useEffect(() => {
    if (!appReady) return;
    const refresh = () => useExposure.getState().refresh(ds().me.id);
    const start = () => (useExposure.persist.hasHydrated() ? refresh() : useExposure.persist.onFinishHydration(refresh));
    const unsubHydrate = start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      if (typeof unsubHydrate === 'function') unsubHydrate();
      sub.remove();
    };
  }, [appReady, mode, uid]);

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
          {/* Phase 7A: After Dark v2 */}
          <Stack.Screen name="after-dark/vibe/[id]" options={{ contentStyle: { backgroundColor: '#07060A' } }} />
          <Stack.Screen name="after-dark/challenge/[id]" options={{ contentStyle: { backgroundColor: '#07060A' } }} />
          <Stack.Screen name="after-dark/card" options={{ contentStyle: { backgroundColor: '#07060A' } }} />
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
        {/* Build 5 patch: the one shared bottom bar also over a Board and normal chats. */}
        {appReady ? <NestedNav /> : null}
        {appReady ? <MediaViewer /> : null}
        {/* Phase 7C: a quiet "Offline" pill (REAL only; never blocks anything). */}
        {appReady && mode === 'real' ? <OfflineBanner /> : null}
        </AppReviewFrame>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/** The shared bar over nested screens that keep it (hidden while the keyboard is up). */
function NestedNav() {
  const pathname = usePathname();
  const keyboard = useKeyboardHeight();
  if (!keepsBottomNav(pathname) || keyboard > 0) return null;
  return <NestedTabBar />;
}

function SwitchingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: AUTH_BG, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Switching account">
      <ActivityIndicator color="#FF6B61" />
      <T style={{ color: '#B9B4D6', fontSize: 15, marginTop: 12 }}>One moment…</T>
    </View>
  );
}
