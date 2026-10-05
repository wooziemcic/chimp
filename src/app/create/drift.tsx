import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Composer, Input, PhotoPicker, WorldPicker, useWorldChoices } from '@/components/create/CreateParts';
import { PhotosCopyNote, PostStatus } from '@/components/create/PostStatus';
import { useDraftComposer } from '@/components/create/useDraftComposer';
import { T } from '@/components/ui/Text';
import { pickImages } from '@/services/backend/media';
import { colors } from '@/theme';

const MAX = 6;

/**
 * New Drift: one photo or a carousel (up to 6), a caption, a World.
 * Posting reliability: a durable draft (photos you take are kept and saved to
 * Photos at once; Share never reports success before the server confirms).
 */
export default function NewDrift() {
  const params = useLocalSearchParams<{ board?: string }>();
  const worlds = useWorldChoices();
  const c = useDraftComposer('drift', '/happening', { boardId: params.board ?? worlds[0]?.id ?? null });
  const [boardId, setBoardId] = useState<string | null>(c.resumed ? c.resumed.boardId : params.board ?? worlds[0]?.id ?? null);
  const [caption, setCaption] = useState(c.resumed?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const images = c.media;
  const content = () => ({ body: caption, boardId });

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    try {
      const got = await pickImages({ source, multiple: true, limit: MAX - images.length });
      await c.add(content(), got.slice(0, MAX - images.length).map((image) => ({ image })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const share = () => {
    if (!boardId || !images.length || c.posting) return;
    setError(null);
    void c.post(content());
  };

  return (
    <Composer
      title="Photos in a World"
      action={c.failed ? 'Try again' : 'Share'}
      onAction={share}
      disabled={!boardId || !images.length}
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
      <PhotoPicker images={images} onPick={pick} onRemove={(i) => images[i] && c.removeMedia(images[i].key)} max={MAX} />
      <PhotosCopyNote media={images} />
      <WorldPicker value={boardId} onChange={setBoardId} label="World" />
      <Input value={caption} onChangeText={setCaption} placeholder="Caption" multiline max={500} counter />
      <T v="caption" color={colors.inkFaint}>
        Photos are resized on your phone before upload.
      </T>
    </Composer>
  );
}
