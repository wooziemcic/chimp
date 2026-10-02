/**
 * Phase 7A: voice notes (expo-audio). Recording asks for the microphone only
 * when you tap the mic; nothing is recorded in the background.
 */
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Pause, Play } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { DEMO_VOICE_URI } from '@/services/demoAfterDark';
import { ad } from './adTheme';

const DEMO_VOICE = require('../../../../assets/demo/after-dark-voice.mp3') as number;
/** Longest voice note (the database allows up to 5 minutes). */
export const MAX_VOICE_MS = 2 * 60 * 1000;

export const durationText = (ms: number | undefined) => {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A few steady bars from the message id (decoration, not a real waveform). */
function bars(seed: string, n = 26): number[] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345 + i) >>> 0;
    return 0.25 + ((h >>> 8) % 1000) / 1333;
  });
}

export function VoiceBubble({ id, uri, durationMs, mine }: { id: string; uri?: string; durationMs?: number; mine: boolean }) {
  const source = uri === DEMO_VOICE_URI ? DEMO_VOICE : uri ?? null;
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const shape = useMemo(() => bars(id), [id]);
  const total = (status.duration || 0) * 1000 || durationMs || 0;
  const progress = total ? Math.min(1, (status.currentTime * 1000) / total) : 0;

  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const toggle = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
    } catch {
      // Web / older OS: plays anyway.
    }
    player.play();
  };

  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]} testID={`voice-${id}`}>
      <Tap onPress={toggle} disabled={!source} style={[styles.play, mine && { backgroundColor: 'rgba(255,255,255,0.22)' }]} accessibilityLabel={status.playing ? 'Pause voice note' : 'Play voice note'} testID={`voice-play-${id}`}>
        {status.playing ? <Pause size={16} color="#fff" fill="#fff" /> : <Play size={16} color="#fff" fill="#fff" style={{ marginLeft: 2 }} />}
      </Tap>
      <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {shape.map((v, i) => (
          <View key={i} style={[styles.barLine, { height: 4 + v * 20, backgroundColor: i / shape.length <= progress ? '#fff' : mine ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.32)' }]} />
        ))}
      </View>
      <T v="caption" weight="700" color="#fff" style={{ marginLeft: 8, minWidth: 30 }}>
        {durationText(status.playing || status.currentTime ? status.currentTime * 1000 : total)}
      </T>
    </View>
  );
}

/** Tap the mic to record, tap send to send (or cancel). */
export function useVoiceRecorder(onError: (m: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const [active, setActive] = useState(false);
  const busy = useRef(false);

  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        onError('Chimp needs the microphone for voice notes. You can allow it in Settings.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setActive(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Couldn’t start recording.');
    } finally {
      busy.current = false;
    }
  }, [recorder, onError]);

  const finish = useCallback(
    async (keep: boolean): Promise<{ uri: string; durationMs: number } | null> => {
      if (!active) return null;
      const durationMs = state.durationMillis;
      setActive(false);
      try {
        await recorder.stop();
      } catch {
        // already stopped
      }
      try {
        await setAudioModeAsync({ allowsRecording: false });
      } catch {
        // ignore
      }
      const uri = recorder.uri ?? state.url;
      if (!keep || !uri) return null;
      if (durationMs < 700) {
        onError('Hold on a little longer — that was too short.');
        return null;
      }
      return { uri, durationMs: Math.min(durationMs, MAX_VOICE_MS) };
    },
    [active, recorder, state.durationMillis, state.url, onError],
  );

  return { active, durationMs: state.durationMillis, start, finish };
}

const styles = StyleSheet.create({
  bubble: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, borderRadius: 22, width: 240 },
  mine: { backgroundColor: ad.pinkDeep, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: ad.raised, borderBottomLeftRadius: 6 },
  play: { width: 34, height: 34, borderRadius: 17, backgroundColor: ad.pink, alignItems: 'center', justifyContent: 'center' },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 28, marginLeft: 8 },
  barLine: { width: 3, borderRadius: 2 },
});
