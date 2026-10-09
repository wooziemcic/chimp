import { Eye, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import { PersonRow } from '@/components/profile/PersonRow';
import { useDeviceInsets } from '@/components/system/SafeArea';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { fetchPeople, fetchStoryViewers } from '@/services/backend/content';
import { toUser } from '@/services/backend/mappers';
import * as realData from '@/services/backend/realData';
import { useDatasetVersion } from '@/services/dataset';
import { repo } from '@/services/repository';
import { colors, radius } from '@/theme';
import { whenLabel } from '@/utils/format';

/**
 * Phase 9.2 follow-up: who viewed one of YOUR Story frames (story_viewers,
 * 0014 — the server answers only the frame's author). Avatar, name,
 * @username and Follow / Following; tapping a person opens their profile.
 */
export function StoryViewersSheet({ frameId, open, onClose, onOpenProfile }: { frameId: string; open: boolean; onClose: () => void; onOpenProfile: (id: string) => void }) {
  const insets = useDeviceInsets();
  useDatasetVersion((d) => d.version); // re-render when viewers' profiles arrive
  const [rows, setRows] = useState<{ frameId: string; list: { userId: string; viewedAt: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    (async () => {
      try {
        const list = await fetchStoryViewers(frameId);
        const unknown = list.map((v) => v.userId).filter((id) => !repo.user(id));
        if (unknown.length) {
          const people = await fetchPeople(unknown);
          if (people.length) realData.addPeople(people.map((p) => toUser(p)));
        }
        if (live) {
          setError(null);
          setRows({ frameId, list });
        }
      } catch (e) {
        if (live) {
          setError(e instanceof Error ? e.message : String(e));
          setRows({ frameId, list: [] });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [open, frameId]);

  const loading = !rows || rows.frameId !== frameId;
  const people = (loading ? [] : rows.list).map((v) => ({ ...v, user: repo.user(v.userId) })).filter((v) => v.user);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close viewers">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]} onPress={() => undefined} testID="story-viewers">
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Eye size={18} color={colors.ink} />
            <T v="headline" style={{ marginLeft: 8, flex: 1 }} testID="story-viewers-title">
              {loading ? 'Seen by' : `Seen by ${rows.list.length}`}
            </T>
            <Tap onPress={onClose} accessibilityLabel="Close" style={styles.close}>
              <X size={20} color={colors.ink} />
            </Tap>
          </View>
          {loading ? (
            <ActivityIndicator style={{ marginVertical: 28 }} color={colors.accent} />
          ) : (
            <FlatList
              data={people}
              keyExtractor={(v) => v.userId}
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ paddingHorizontal: 18 }}
              ListHeaderComponent={
                error ? (
                  <T v="footnote" color={colors.danger} style={{ marginBottom: 8 }}>
                    {`Couldn’t load viewers. ${error}`}
                  </T>
                ) : null
              }
              renderItem={({ item: v }) => (
                <PersonRow user={v.user!} subtitle={[v.user!.username ? `@${v.user!.username}` : null, whenLabel(v.viewedAt)].filter(Boolean).join(' · ')} onOpen={() => onOpenProfile(v.userId)} />
              )}
              ListEmptyComponent={
                error ? null : (
                  <T v="subhead" color={colors.inkMuted} align="center" style={{ marginVertical: 28 }}>
                    No views yet
                  </T>
                )
              }
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(8,10,16,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, width: '100%', maxWidth: 560, alignSelf: 'center' },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong, marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, marginBottom: 4 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
});
