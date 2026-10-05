import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Composer, Input, PhotoPicker, WorldPicker } from '@/components/create/CreateParts';
import { PhotosCopyNote, PostStatus } from '@/components/create/PostStatus';
import { useDraftComposer } from '@/components/create/useDraftComposer';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { pickImages } from '@/services/backend/media';
import { colors } from '@/theme';

/**
 * New Story: one photo for 24 hours, on your own story or shared into a World too.
 * Posting reliability: a durable draft (a photo you take is kept and saved to
 * Photos at once; Share never reports success before the server confirms).
 */
export default function NewStory() {
  const params = useLocalSearchParams<{ board?: string }>();
  const c = useDraftComposer('story', '/happening', { boardId: params.board ?? null, toWorld: !!params.board });
  const [caption, setCaption] = useState(c.resumed?.body ?? '');
  const [toWorld, setToWorld] = useState(c.resumed ? !!c.resumed.toWorld : !!params.board);
  const [boardId, setBoardId] = useState<string | null>(c.resumed ? c.resumed.boardId : params.board ?? null);
  const [error, setError] = useState<string | null>(null);
  const image = c.media[0] ?? null;
  const content = () => ({ body: caption, boardId, toWorld });

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    try {
      const [img] = await pickImages({ source });
      if (img) await c.add(content(), [{ image: img }], { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const share = () => {
    if (!image || c.posting) return;
    setError(null);
    void c.post(content());
  };

  return (
    <Composer
      title="New Story"
      action={c.failed ? 'Try again' : 'Share'}
      onAction={share}
      disabled={!image || (toWorld && !boardId)}
      busy={c.posting}
      error={error}
      onCancel={c.cancel}
      cancelLabel={c.posting ? 'Stop' : 'Cancel'}
      status={
        <PostStatus
          progress={c.progress}
          posting={c.posting}
          failed={c.failed}
          cancelling={c.cancelling}
          atRisk={c.atRisk}
          onRetry={share}
          onKeep={() => c.keep(content())}
          onDiscard={() => void c.discard()}
          onBack={() => c.setCancelling(false)}
        />
      }
    >
      <PhotoPicker images={image ? [image] : []} onPick={pick} onRemove={() => image && c.removeMedia(image.key)} max={1} />
      <PhotosCopyNote media={c.media} />
      <Input value={caption} onChangeText={setCaption} placeholder="Add a caption" max={200} counter />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {[
          { on: !toWorld, label: 'My story', run: () => setToWorld(false) },
          { on: toWorld, label: 'My story + a World', run: () => setToWorld(true) },
        ].map((o) => (
          <Tap key={o.label} onPress={o.run} style={{ flex: 1, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: o.on ? colors.accent : colors.line, backgroundColor: o.on ? colors.accentSoft : colors.surface, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={o.label}>
            <T v="footnote" weight="700" color={o.on ? colors.accent : colors.ink2}>
              {o.label}
            </T>
          </Tap>
        ))}
      </View>
      {toWorld ? <WorldPicker value={boardId} onChange={setBoardId} label="Also in" /> : null}
      <T v="caption" color={colors.inkFaint}>
        Stories disappear after 24 hours.
      </T>
    </Composer>
  );
}
