/**
 * Phase 6C: one small, stable video surface (expo-video, bundled in Expo Go).
 *
 *   - plays only while `active`; pauses the moment it isn't (only one clip
 *     ever plays — the viewer / Drift decide which one is active)
 *   - tap to pause / play; optional mute button; thin progress bar
 *   - poster + spinner while loading; a plain "couldn't play" state with Retry
 *   - keeps the clip's aspect ratio (contain) unless the caller asks for cover
 *
 * Feed cards never mount this (they show a poster): nothing autoplays with
 * sound on a feed, and no off-screen player keeps running. The player is
 * released when the component unmounts.
 */
import { useEvent } from 'expo';
import { useVideoPlayer, type VideoPlayer, VideoView } from 'expo-video';
import { AlertCircle, Play, RotateCw, Volume2, VolumeX } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { colors } from '@/theme';

/** The player is a native object with an imperative API; these keep its mutation in one place. */
function applyPlayer(p: VideoPlayer, opts: { muted: boolean; loop: boolean }) {
  p.muted = opts.muted;
  p.loop = opts.loop;
}
function setup(p: VideoPlayer) {
  p.timeUpdateEventInterval = 0.25;
}

export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Props {
  uri: string;
  poster?: string;
  /** Only the active clip plays. */
  active: boolean;
  muted: boolean;
  onToggleMute?: () => void;
  loop?: boolean;
  contentFit?: 'contain' | 'cover';
  style?: StyleProp<ViewStyle>;
  /** Where the mute button sits (Drift keeps it clear of its action rail). */
  muteStyle?: StyleProp<ViewStyle>;
  /** Hide the thin progress bar (Drift draws its own chrome). */
  hideProgress?: boolean;
}

export function ChimpVideo({ uri, poster, active, muted, onToggleMute, loop = true, contentFit = 'contain', style, muteStyle, hideProgress }: Props) {
  const player = useVideoPlayer(uri, setup);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { currentTime } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  // Paused by you (tap) — stays paused until you tap again or the clip becomes active again.
  const [held, setHeld] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (active) setHeld(false);
  }

  useEffect(() => {
    applyPlayer(player, { muted, loop });
  }, [player, muted, loop]);

  useEffect(() => {
    if (active && !held) player.play();
    else player.pause();
  }, [player, active, held]);

  const duration = player.duration || 0;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const loading = active && !held && (status === 'loading' || status === 'idle') && !isPlaying;
  const failed = status === 'error';

  return (
    <View style={[styles.root, style]}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={contentFit} nativeControls={false} />
      {/* Poster until the first frame plays (and whenever the clip isn't active). */}
      {poster && (!isPlaying || !active) && currentTime === 0 ? <Img uri={poster} contentFit={contentFit} tint="#000" style={StyleSheet.absoluteFill} /> : null}

      {failed ? (
        <View style={styles.center}>
          <AlertCircle size={28} color={colors.white} />
          <T v="subhead" weight="700" color={colors.white} style={{ marginTop: 8 }}>
            Couldn’t play this video
          </T>
          <Tap onPress={() => void player.replaceAsync(uri)} style={styles.retry} accessibilityLabel="Retry video">
            <RotateCw size={15} color={colors.ink} />
            <T v="footnote" weight="700" style={{ marginLeft: 6 }}>
              Retry
            </T>
          </Tap>
        </View>
      ) : (
        <Tap onPress={() => setHeld((h) => !h)} scaleTo={1} style={StyleSheet.absoluteFill} accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}>
          <View style={styles.center} pointerEvents="none">
            {loading ? <ActivityIndicator color={colors.white} /> : !isPlaying ? (
              <View style={styles.bigBtn}>
                <Play size={30} color={colors.white} fill={colors.white} />
              </View>
            ) : null}
          </View>
        </Tap>
      )}

      {onToggleMute && !failed ? (
        <Tap onPress={onToggleMute} style={[styles.mute, muteStyle ?? { bottom: 16, right: 16 }]} accessibilityLabel={muted ? 'Unmute' : 'Mute'}>
          {muted ? <VolumeX size={18} color={colors.white} /> : <Volume2 size={18} color={colors.white} />}
        </Tap>
      ) : null}

      {duration > 0 && !hideProgress ? (
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

/** A clip as it appears in a feed: its poster (or a dark frame), a play badge and the length. Never plays here. */
export function VideoPoster({ poster, durationMs, width, height }: { poster?: string; durationMs?: number; width: number; height: number }) {
  const len = formatDuration(durationMs);
  return (
    <View style={{ width, height, backgroundColor: '#111' }}>
      {poster ? <Img uri={poster} tint="#111" style={StyleSheet.absoluteFill} /> : null}
      <View style={styles.center} pointerEvents="none">
        <View style={styles.bigBtn}>
          <Play size={28} color={colors.white} fill={colors.white} />
        </View>
      </View>
      {len ? (
        <View style={styles.len} pointerEvents="none">
          <T v="caption" weight="700" color={colors.white} style={{ fontSize: 12 }}>
            {len}
          </T>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', overflow: 'hidden' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  bigBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  retry: { flexDirection: 'row', alignItems: 'center', marginTop: 12, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.white },
  mute: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  fill: { height: 3, backgroundColor: colors.white },
  len: { position: 'absolute', right: 10, bottom: 10, paddingHorizontal: 7, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center' },
});
