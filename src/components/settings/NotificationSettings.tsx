/**
 * Phase 7C: Settings → Notifications. Three switches (Messages, Connections,
 * After Dark), stored on the server (notification_prefs, 0009) so they apply
 * to every phone you're signed in on. After Dark notifications are always
 * generic ("New After Dark message") — never a name, a Crush or content.
 */
import { Bell, BellOff, Heart, MessageCircle, Sparkles, Users } from 'lucide-react-native';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Switch, View } from 'react-native';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { DEFAULT_PREFS, ensurePushRegistered, fetchNotificationPrefs, type NotificationPrefs, openSystemSettings, type PushPermission, pushPermission, saveNotificationPrefs } from '@/services/push';
import { colors, radius } from '@/theme';

const ROWS: { key: keyof NotificationPrefs; label: string; body: string; icon: ReactNode }[] = [
  { key: 'messages', label: 'Messages', body: 'Who wrote to you. Never what they wrote.', icon: <MessageCircle size={18} color={colors.accent} /> },
  { key: 'connections', label: 'Connections', body: 'New followers, requests and accepted connections.', icon: <Users size={18} color={colors.accent} /> },
  { key: 'activity', label: 'Activity', body: 'Likes and replies on your posts, and new posts in Worlds you follow.', icon: <Sparkles size={18} color={colors.accent} /> },
  { key: 'after_dark', label: 'After Dark', body: 'Always discreet: “New After Dark message”, never a name.', icon: <Heart size={18} color={colors.accent} /> },
];

export function NotificationSettings() {
  const [perm, setPerm] = useState<PushPermission | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void pushPermission().then(setPerm);
  }, []);
  useEffect(() => {
    reload();
    void fetchNotificationPrefs().then(setPrefs);
    // Coming back from iOS Settings: show the new permission.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && reload());
    return () => sub.remove();
  }, [reload]);

  const toggle = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    setError(null);
    try {
      setPrefs(await saveNotificationPrefs({ [key]: value }));
    } catch (e) {
      setPrefs(before);
      setError(e instanceof Error ? e.message : 'Couldn’t save.');
    }
  };

  return (
    <View style={styles.group} testID="settings-notifications">
      <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
        NOTIFICATIONS
      </T>
      {perm === 'unsupported' ? (
        <Info icon={<Bell size={18} color={colors.inkMuted} />} text="Notifications work in the iPhone app." />
      ) : perm === 'denied' ? (
        <Tap onPress={() => void openSystemSettings()} style={styles.option} accessibilityLabel="Open iOS Settings to allow notifications">
          <BellOff size={18} color={colors.inkMuted} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <T v="bodyStrong">Notifications are off</T>
            <T v="footnote" color={colors.inkMuted} weight="400">
              Turn them on in iOS Settings → Chimp → Notifications.
            </T>
          </View>
          <T v="footnote" weight="700" color={colors.accent}>
            Open
          </T>
        </Tap>
      ) : perm === 'undetermined' ? (
        <Tap onPress={() => void ensurePushRegistered({ ask: 'now' }).then(setPerm)} style={styles.option} accessibilityLabel="Turn on notifications" testID="notifications-enable">
          <Bell size={18} color={colors.accent} />
          <T v="bodyStrong" color={colors.accent} style={{ marginLeft: 12, flex: 1 }}>
            Turn on notifications
          </T>
        </Tap>
      ) : null}
      {prefs === null ? (
        <Info icon={<Bell size={18} color={colors.inkMuted} />} text="Notification settings aren’t available yet." />
      ) : (
        ROWS.map((r) => (
          <View key={r.key} style={styles.option}>
            {r.icon}
            <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
              <T v="bodyStrong">{r.label}</T>
              <T v="footnote" color={colors.inkMuted} weight="400">
                {r.body}
              </T>
            </View>
            <Switch
              value={(prefs ?? DEFAULT_PREFS)[r.key]}
              disabled={!prefs}
              onValueChange={(v) => void toggle(r.key, v)}
              trackColor={{ true: colors.accent, false: colors.lineStrong }}
              accessibilityLabel={`${r.label} notifications`}
              testID={`notify-${r.key}`}
            />
          </View>
        ))
      )}
      {error ? (
        <T v="footnote" color={colors.danger} style={{ marginTop: 2 }}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

function Info({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={styles.option}>
      {icon}
      <T v="footnote" color={colors.inkMuted} weight="400" style={{ marginLeft: 12, flex: 1 }}>
        {text}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: 20 },
  option: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, marginBottom: 8 },
});
