import { useLocalSearchParams } from 'expo-router';
import { BarChart3, Camera, Film, Globe2, ImageIcon, Plus, Video, X } from 'lucide-react-native';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Composer, Input, PhotoPicker, WorldPicker } from '@/components/create/CreateParts';
import { PhotosCopyNote, PostStatus } from '@/components/create/PostStatus';
import { useDraftComposer } from '@/components/create/useDraftComposer';
import { Avatar } from '@/components/ui/Avatar';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { useMyAvatar } from '@/hooks/useGraph';
import { VideoPoster, formatDuration } from '@/components/media/ChimpVideo';
import { makePoster, pickImages, pickVideo, videoProblem } from '@/services/backend/media';
import { repo } from '@/services/repository';
import { progressText } from '@/utils/postDraft';
import { colors, radius } from '@/theme';

const LIMIT = { post: 500, text: 2000, question: 140, option: 60, photos: 4 };

/**
 * New Buzz (Phase 6B): say something. Everything else is optional — photos,
 * a short video (Phase 6C), a poll, a World. "Just Buzz" (no World) is the default; a World is context,
 * not a requirement. There is no Meme type: a meme is a photo with a caption,
 * and the caption is never painted over the photo.
 */
export default function NewBuzz() {
  const params = useLocalSearchParams<{ board?: string; kind?: string; pick?: string }>();
  const me = repo.me();
  const avatar = useMyAvatar();
  const initialBoard = params.board && repo.board(params.board) ? params.board : null;
  // Posting reliability: one durable draft per composer (kept across retries and restarts).
  const c = useDraftComposer('buzz', '/buzz', { boardId: initialBoard });
  const [body, setBody] = useState(c.resumed?.body ?? '');
  const [poll, setPoll] = useState(c.resumed ? !!c.resumed.poll : params.kind === 'poll');
  const [options, setOptions] = useState(c.resumed?.poll?.options ?? ['', '']);
  const [boardId, setBoardId] = useState<string | null>(c.resumed ? c.resumed.boardId : initialBoard);
  const [showWorlds, setShowWorlds] = useState(!!boardId);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);

  const images = c.media.filter((m) => m.kind === 'image');
  const video = c.media.find((m) => m.kind === 'video') ?? null;
  const busy = c.posting;
  const text = body.trim();
  const filledOptions = options.map((o) => o.trim()).filter(Boolean);
  const valid = poll ? text.length > 0 && text.length <= LIMIT.question && filledOptions.length >= 2 : text.length > 0 || images.length > 0 || !!video;
  const max = poll ? LIMIT.question : LIMIT.text;
  const content = () => ({ body: poll ? text : body, boardId, poll: poll ? { question: text, options: filledOptions } : null });

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    try {
      const got = await pickImages({ source, multiple: source === 'library', limit: LIMIT.photos - images.length });
      await c.add(content(), got.slice(0, LIMIT.photos - images.length).map((image) => ({ image })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const chooseVideo = async () => {
    setError(null);
    try {
      const v = await pickVideo();
      if (!v) return;
      const problem = videoProblem(v);
      if (problem) return setError(problem);
      // The poster frame (iPhone) shows in the preview and is reused for the upload.
      const poster = await makePoster(v);
      await c.add(content(), [{ video: poster ? { ...v, poster } : v }], { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // "Add video" on a World opens straight into the camera roll ("Record video" into the recorder).
  const onOpen = useEffectEvent(() => {
    if (params.pick === 'video') void chooseVideo();
    if (params.pick === 'record') c.openRecorder(content());
  });
  useEffect(() => {
    const t = setTimeout(onOpen, 0);
    return () => clearTimeout(t);
  }, []);

  const post = () => {
    if (!valid || busy) return;
    setError(null);
    void c.post(content());
  };

  const world = boardId ? repo.board(boardId) : undefined;
  return (
    <Composer
      title="New Buzz"
      action={c.failed ? 'Try again' : 'Post'}
      onAction={post}
      disabled={!valid}
      busy={busy}
      error={error}
      onCancel={c.cancel}
      cancelLabel={busy ? 'Stop' : 'Cancel'}
      status={
        <PostStatus
          progress={c.progress}
          posting={busy}
          failed={c.failed}
          cancelling={c.cancelling}
          atRisk={c.atRisk}
          onRetry={post}
          onKeep={() => c.keep(content())}
          onDiscard={() => void c.discard()}
          onBack={() => c.setCancelling(false)}
        />
      }
    >
      <View style={{ flexDirection: 'row' }}>
        <Avatar uri={avatar ?? me.avatar} name={me.displayName} size={40} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <TextInput
            ref={input}
            value={body}
            onChangeText={setBody}
            placeholder={poll ? 'Ask something…' : 'What’s buzzing?'}
            placeholderTextColor={colors.inkFaint}
            multiline
            autoFocus
            maxLength={max}
            style={styles.main}
            accessibilityLabel={poll ? 'Poll question' : 'What’s buzzing?'}
          />
          {body.length > max * 0.8 ? (
            <T v="caption" color={body.length >= max ? colors.danger : colors.inkFaint} align="right">
              {`${body.length}/${max}`}
            </T>
          ) : null}
        </View>
      </View>

      {!poll && video ? (
        <View style={styles.videoBox}>
          <VideoPoster poster={video.poster?.uri} durationMs={video.durationMs} width={120} height={Math.round(120 / Math.max(0.56, Math.min(1.78, video.width / Math.max(1, video.height) || 0.56)))} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <T v="subhead" weight="700">
              {`Video${video.durationMs ? ` · ${formatDuration(video.durationMs)}` : ''}`}
            </T>
            <T v="caption" color={colors.inkMuted} style={{ marginTop: 2 }}>
              {busy ? progressText(c.progress) || 'Preparing…' : video.captured ? 'Recorded in Chimp · up to 60 seconds' : 'Up to 60 seconds. Plays in Buzz and Drift.'}
            </T>
          </View>
          {!busy ? (
            <Tap onPress={() => c.removeMedia(video.key)} style={styles.removeOpt} accessibilityLabel="Remove video">
              <X size={18} color={colors.inkMuted} />
            </Tap>
          ) : null}
        </View>
      ) : null}

      {!poll && images.length ? (
        <View style={{ marginTop: 12 }}>
          <PhotoPicker images={images} onPick={pick} onRemove={(i) => images[i] && c.removeMedia(images[i].key)} max={images.length} />
        </View>
      ) : null}
      {!poll ? <PhotosCopyNote media={c.media} /> : null}

      {poll ? (
        <View style={styles.pollBox}>
          {options.map((o, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Input value={o} onChangeText={(t) => setOptions((cur) => cur.map((x, k) => (k === i ? t : x)))} placeholder={`Option ${i + 1}`} max={LIMIT.option} />
              </View>
              {options.length > 2 ? (
                <Tap onPress={() => setOptions((cur) => cur.filter((_, k) => k !== i))} style={styles.removeOpt} accessibilityLabel="Remove option">
                  <X size={18} color={colors.inkMuted} />
                </Tap>
              ) : null}
            </View>
          ))}
          {options.length < 4 ? (
            <Tap onPress={() => setOptions((cur) => [...cur, ''])} style={{ flexDirection: 'row', alignItems: 'center', height: 36 }} accessibilityLabel="Add option">
              <Plus size={16} color={colors.accent} />
              <T v="subhead" weight="600" color={colors.accent} style={{ marginLeft: 6 }}>
                Add option
              </T>
            </Tap>
          ) : null}
        </View>
      ) : null}

      {/* Optional extras: media, poll, World. */}
      <View style={styles.tools}>
        {!poll ? (
          <>
            <Tool icon={<Camera size={18} color={colors.accent} />} label="Camera" onPress={() => pick('camera')} disabled={busy || !!video || images.length >= LIMIT.photos} />
            <Tool icon={<ImageIcon size={18} color={colors.accent} />} label="Photos" onPress={() => pick('library')} disabled={busy || !!video || images.length >= LIMIT.photos} />
            <Tool icon={<Video size={18} color={colors.accent} />} label="Record" onPress={() => c.openRecorder(content())} disabled={busy || images.length > 0 || !!video} />
            <Tool icon={<Film size={18} color={colors.accent} />} label="Video" onPress={() => void chooseVideo()} disabled={busy || images.length > 0 || !!video} />
          </>
        ) : null}
        <Tool
          icon={<BarChart3 size={18} color={poll ? colors.white : colors.accent} />}
          label={poll ? 'Poll on' : 'Poll'}
          on={poll}
          onPress={() => {
            setPoll((p) => !p);
            if (!poll) c.replaceMedia([]);
          }}
        />
        <Tool icon={<Globe2 size={18} color={world ? colors.white : colors.accent} />} label={world ? world.title : 'World'} on={!!world} onPress={() => setShowWorlds((v) => !v)} />
      </View>

      {showWorlds ? (
        <View style={{ marginTop: 14 }}>
          <WorldPicker value={boardId} onChange={setBoardId} label="Attach to a World (optional)" allowNone />
        </View>
      ) : (
        <T v="caption" color={colors.inkFaint} style={{ marginTop: 10 }}>
          {world ? `Posting in ${world.title}` : 'Posting as Just Buzz. Attach a World if it belongs somewhere.'}
        </T>
      )}
    </Composer>
  );
}

function Tool({ icon, label, onPress, on, disabled }: { icon: React.ReactNode; label: string; onPress: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <Tap onPress={onPress} disabled={disabled} style={[styles.tool, on && styles.toolOn, disabled && { opacity: 0.4 }]} accessibilityLabel={label}>
      {icon}
      <T v="footnote" weight="700" color={on ? colors.white : colors.accent} numberOfLines={1} style={{ marginLeft: 6, maxWidth: 120 }}>
        {label}
      </T>
    </Tap>
  );
}

const styles = StyleSheet.create({
  main: { minHeight: 90, fontSize: 19, lineHeight: 25, color: colors.ink, paddingTop: 8, textAlignVertical: 'top' },
  pollBox: { marginTop: 12, padding: 12, paddingBottom: 4, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  removeOpt: { width: 40, height: 50, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  tool: { flexDirection: 'row', alignItems: 'center', height: 38, paddingHorizontal: 12, borderRadius: 19, backgroundColor: colors.accentSoft },
  toolOn: { backgroundColor: colors.accent },
  videoBox: { flexDirection: 'row', alignItems: 'center', marginTop: 12, padding: 10, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
});
