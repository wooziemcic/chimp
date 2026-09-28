import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Composer, Input, PhotoPicker, WorldPicker, closeComposer } from '@/components/create/CreateParts';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { type PickedImage, pickImages } from '@/services/backend/media';
import { postStory } from '@/services/create';
import { colors } from '@/theme';

/** New Story: one photo for 24 hours, on your own story or shared into a World too. */
export default function NewStory() {
  const params = useLocalSearchParams<{ board?: string }>();
  const [image, setImage] = useState<PickedImage | null>(null);
  const [caption, setCaption] = useState('');
  const [toWorld, setToWorld] = useState(!!params.board);
  const [boardId, setBoardId] = useState<string | null>(params.board ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: 'camera' | 'library') => {
    try {
      const [img] = await pickImages({ source });
      if (img) setImage(img);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const share = async () => {
    if (!image) return;
    setBusy(true);
    setError(null);
    try {
      await postStory(toWorld ? boardId : null, caption, image);
      closeComposer('/happening');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Composer title="New Story" action="Share" onAction={share} disabled={!image || (toWorld && !boardId)} busy={busy} error={error}>
      <PhotoPicker images={image ? [image] : []} onPick={pick} onRemove={() => setImage(null)} max={1} />
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
