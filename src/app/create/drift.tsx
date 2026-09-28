import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Composer, Input, PhotoPicker, WorldPicker, useWorldChoices, closeComposer } from '@/components/create/CreateParts';
import { T } from '@/components/ui/Text';
import { type PickedImage, pickImages } from '@/services/backend/media';
import { postDrift } from '@/services/create';
import { colors } from '@/theme';

const MAX = 6;

/** New Drift: one photo or a carousel (up to 6), a caption, a World. */
export default function NewDrift() {
  const params = useLocalSearchParams<{ board?: string }>();
  const worlds = useWorldChoices();
  const [boardId, setBoardId] = useState<string | null>(params.board ?? worlds[0]?.id ?? null);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: 'camera' | 'library') => {
    try {
      const got = await pickImages({ source, multiple: true, limit: MAX - images.length });
      setImages((cur) => [...cur, ...got].slice(0, MAX));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const share = async () => {
    if (!boardId || !images.length) return;
    setBusy(true);
    setError(null);
    try {
      await postDrift(boardId, caption, images);
      closeComposer('/happening');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Composer title="Photos in a World" action="Share" onAction={share} disabled={!boardId || !images.length} busy={busy} error={error}>
      <PhotoPicker images={images} onPick={pick} onRemove={(i) => setImages((cur) => cur.filter((_, k) => k !== i))} max={MAX} />
      <WorldPicker value={boardId} onChange={setBoardId} label="World" />
      <Input value={caption} onChangeText={setCaption} placeholder="Caption" multiline max={500} counter />
      <T v="caption" color={colors.inkFaint}>
        Photos are resized on your phone before upload. Video comes in a later phase.
      </T>
    </Composer>
  );
}
