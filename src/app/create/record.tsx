import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { RefreshCcw, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';

import { FullscreenTopBar, MIN_TAP, useDeviceInsets } from '@/components/system/SafeArea';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { formatDuration } from '@/components/media/ChimpVideo';
import { type PickedVideo, VIDEO_LIMITS, makePoster } from '@/services/backend/media';
import { newDraft, preserveCaptured, toDraftMedia, usePostDrafts } from '@/services/postDrafts';

/**
 * Record a short video inside Chimp (no need to leave for the Camera app).
 *
 *   - up to 60 seconds (the same limit as videos from your library), stops by itself
 *   - 720p H.264 at ~3.5 Mbit/s: about 26 MB a minute — sharp on a phone,
 *     and quick to upload over mobile data (a 1080p/4K original is 3–10× bigger)
 *   - the moment it stops, the clip is kept in Chimp and saved to Photos
 *     (if you allow it) BEFORE anything is uploaded, so it can't be lost
 *   - no microphone access → records without sound (and says so)
 *
 * Opened from a composer with `?draft=<id>`: the clip is added to that draft,
 * then you're back in the composer to post it.
 */
const BITRATE = 3_500_000;
/** Safety net under the 50 MB upload limit (recording stops if it's ever reached). */
const MAX_FILE_BYTES = 45 * 1024 * 1024;

const sinceMs = (t: number) => (t ? Date.now() - t : 0);

/** One recording (stops by itself at 60 s or 45 MB, or when stopRecording is called). */
async function recordClip(cam: CameraView, onStarted: (t: number) => void): Promise<{ uri?: string; durationMs: number }> {
  const t0 = Date.now();
  onStarted(t0);
  const res = await cam.recordAsync({ maxDuration: VIDEO_LIMITS.maxSeconds, maxFileSize: MAX_FILE_BYTES, ...(Platform.OS === 'ios' ? { codec: 'avc1' as const } : {}) });
  return { uri: res?.uri, durationMs: Math.min(VIDEO_LIMITS.maxSeconds * 1000, Date.now() - t0) };
}

export default function RecordVideo() {
  const params = useLocalSearchParams<{ draft?: string; board?: string }>();
  const insets = useDeviceInsets();
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);
  /** Closed while recording: the stopped clip is not kept (you chose to leave). */
  const closing = useRef(false);
  const asked = useRef(false);

  // Ask once for the camera and the microphone (sound is optional).
  useEffect(() => {
    if (asked.current || !camPerm || !micPerm) return;
    asked.current = true;
    void (async () => {
      if (!camPerm.granted && camPerm.canAskAgain) await requestCam();
      if (!micPerm.granted && micPerm.canAskAgain) await requestMic();
    })();
  }, [camPerm, micPerm, requestCam, requestMic]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(sinceMs(startedAt.current)), 200);
    return () => clearInterval(t);
  }, [recording]);

  const muted = !micPerm?.granted;

  const start = async () => {
    if (!camera.current || !ready || recording || saving) return;
    setError(null);
    setElapsed(0);
    setRecording(true);
    try {
      const res = await recordClip(camera.current, (t) => (startedAt.current = t));
      const durationMs = res.durationMs;
      setRecording(false);
      if (!res.uri || closing.current) return;
      if (durationMs < 800) return setError('Hold on a little longer — that was under a second.');
      await keep(res.uri, durationMs);
    } catch (e) {
      setRecording(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stop = () => camera.current?.stopRecording();

  /** Keep the clip (Chimp + Photos) and add it to the composer's draft, then go back. */
  const keep = async (uri: string, durationMs: number) => {
    setSaving(true);
    try {
      const base: PickedVideo = { uri, width: 720, height: 1280, durationMs, mimeType: uri.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/quicktime', captured: true };
      // A poster frame from the clip: also gives the real orientation / aspect.
      const poster = await makePoster(base);
      const clip: PickedVideo = poster ? { ...base, width: poster.width, height: poster.height, poster } : base;
      const store = usePostDrafts.getState();
      const draft = (params.draft && store.drafts[params.draft]) || newDraft('buzz', { ...(params.draft ? { id: params.draft } : {}), boardId: params.board ?? null });
      const [m] = toDraftMedia({ media: [] }, [{ video: clip }]);
      // One clip per Buzz: the new recording replaces any earlier clip in this draft.
      await preserveCaptured(draft, [m], { replace: (x) => x.kind === 'video' });
      if (router.canGoBack()) router.back();
      else router.replace(`/create/buzz?draft=${draft.id}`);
    } catch (e) {
      setSaving(false);
      setError(`Couldn’t keep that clip: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const close = () => {
    if (recording) {
      closing.current = true;
      stop();
    }
    if (router.canGoBack()) router.back();
    else router.replace('/buzz');
  };

  if (camPerm && !camPerm.granted && !camPerm.canAskAgain) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top + 40 }]}>
        <T v="headline" color="#fff" align="center">
          Camera access is off
        </T>
        <T v="footnote" color="rgba(255,255,255,0.75)" align="center" style={{ marginTop: 8, maxWidth: 300 }}>
          Turn on Camera for Chimp in Settings to record a video here.
        </T>
        <Tap onPress={() => void Linking.openSettings()} style={styles.pill} accessibilityLabel="Open Settings">
          <T v="subhead" weight="700" color="#000">
            Open Settings
          </T>
        </Tap>
        <Tap onPress={close} style={[styles.pill, { backgroundColor: 'rgba(255,255,255,0.15)' }]} accessibilityLabel="Close">
          <T v="subhead" weight="700" color="#fff">
            Not now
          </T>
        </Tap>
      </View>
    );
  }

  const left = Math.max(0, VIDEO_LIMITS.maxSeconds * 1000 - elapsed);
  return (
    <View style={styles.root} testID="video-recorder">
      {camPerm?.granted ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          mode="video"
          facing={facing}
          videoQuality="720p"
          videoBitrate={BITRATE}
          mute={muted}
          onCameraReady={() => setReady(true)}
          onMountError={(e) => setError(e.message)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator color="#fff" />
        </View>
      )}

      <FullscreenTopBar
        left={
          <Tap onPress={close} style={styles.icon} accessibilityLabel="Close" hitSlop={8} testID="recorder-close">
            <X size={24} color="#fff" strokeWidth={2.4} />
          </Tap>
        }
        right={
          !recording ? (
            <Tap onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} style={styles.icon} accessibilityLabel="Switch camera" hitSlop={8}>
              <RefreshCcw size={22} color="#fff" strokeWidth={2.4} />
            </Tap>
          ) : (
            <View style={styles.timer} accessibilityLabel={`Recording, ${formatDuration(elapsed)}`}>
              <View style={styles.dot} />
              <T v="subhead" weight="700" color="#fff">{`${formatDuration(elapsed)} / ${formatDuration(VIDEO_LIMITS.maxSeconds * 1000)}`}</T>
            </View>
          )
        }
      />

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]} pointerEvents="box-none">
        {error ? (
          <T v="footnote" color="#FFB4B4" align="center" style={{ marginBottom: 12, paddingHorizontal: 24 }}>
            {error}
          </T>
        ) : (
          <T v="footnote" color="rgba(255,255,255,0.8)" align="center" style={{ marginBottom: 12 }}>
            {saving
              ? 'Keeping your video…'
              : recording
                ? left <= 10_000
                  ? `${Math.ceil(left / 1000)} seconds left`
                  : 'Tap to stop'
                : `Up to ${VIDEO_LIMITS.maxSeconds} seconds${muted ? ' · no sound (microphone is off)' : ''}`}
          </T>
        )}
        {recording ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, (elapsed / (VIDEO_LIMITS.maxSeconds * 1000)) * 100)}%` }]} />
          </View>
        ) : null}
        {saving ? (
          <ActivityIndicator color="#fff" style={{ height: 78 }} />
        ) : (
          <Tap
            onPress={recording ? stop : () => void start()}
            disabled={!ready && !recording}
            style={[styles.shutter, !ready && { opacity: 0.5 }]}
            accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
            testID="record-button"
          >
            <View style={recording ? styles.stopIcon : styles.recIcon} />
          </Tap>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  icon: { width: MIN_TAP, height: MIN_TAP, borderRadius: MIN_TAP / 2, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  timer: { flexDirection: 'row', alignItems: 'center', height: MIN_TAP, paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF3B30', marginRight: 8 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  track: { width: '70%', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 16, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: '#FF3B30' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  recIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FF3B30' },
  stopIcon: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#FF3B30' },
  pill: { marginTop: 18, height: 46, paddingHorizontal: 24, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', minWidth: 200 },
});
