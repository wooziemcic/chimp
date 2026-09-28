import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { linkLoopToWorld } from '@/components/chat/LoopsSheet';
import { Composer, Input, PhotoPicker, Segments } from '@/components/create/CreateParts';
import { Img } from '@/components/ui/Img';
import { Tap } from '@/components/ui/Tap';
import { T } from '@/components/ui/Text';
import { WORLD_CATALOG, catalogCover } from '@/data/worldCatalog';
import { type PickedImage, pickImages } from '@/services/backend/media';
import { makeWorld } from '@/services/create';
import { colors } from '@/theme';

/**
 * New World (Board): name, description, what it's about (category), cover,
 * public or private. The theme engine picks the look from the category;
 * no AI, no 20 settings. A "Niagara Falls Trip" is just a World about Travel.
 */
export default function NewWorld() {
  // Final messaging patch: "Create World" from a chat's Open Loop prefills the
  // name and starts Private; afterwards the loop links to the new World and
  // you add people yourself (nobody from the chat is added automatically).
  const from = useLocalSearchParams<{ title?: string; visibility?: string; loop?: string; cid?: string }>();
  const [title, setTitle] = useState(from.title ? from.title.slice(0, 60) : '');
  const [tagline, setTagline] = useState('');
  const [kindOf, setKindOf] = useState('travel');
  const [also, setAlso] = useState<string[]>([]);
  // Phase 6D: Connections is the default (a new World isn't broadcast to everyone).
  const [visibility, setVisibility] = useState<'public' | 'connections' | 'private'>(from.visibility === 'private' ? 'private' : 'connections');
  const [cover, setCover] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: 'camera' | 'library') => {
    try {
      const [img] = await pickImages({ source });
      if (img) setCover(img);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const board = await makeWorld({ title, tagline, kindOf, visibility, cover, alsoAbout: also });
      if (from.loop && from.cid) await linkLoopToWorld(from.cid, from.loop, board.id);
      else router.replace(`/board/${board.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Composer title="New World" action="Create" onAction={create} disabled={title.trim().length < 2} busy={busy} error={error}>
      <Input value={title} onChangeText={setTitle} placeholder="Name it (e.g. Summer Road Trip)" max={60} />
      <Input value={tagline} onChangeText={setTagline} placeholder="What’s it for? (e.g. A weekend trip with friends)" max={200} counter multiline />
      <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
        CATEGORY
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {WORLD_CATALOG.map((w) => {
          const on = w.id === kindOf;
          return (
            <Tap key={w.id} onPress={() => setKindOf(w.id)} style={{ flexDirection: 'row', alignItems: 'center', height: 36, paddingLeft: 3, paddingRight: 12, borderRadius: 18, borderWidth: 1.5, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface }} accessibilityLabel={w.title}>
              <Img uri={catalogCover(w)} style={{ width: 28, height: 28, borderRadius: 14 }} />
              <T v="footnote" weight="700" color={on ? colors.accent : colors.ink2} style={{ marginLeft: 6 }}>
                {w.title}
              </T>
            </Tap>
          );
        })}
      </View>
      <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
        ALSO ABOUT (OPTIONAL, UP TO 3)
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        {WORLD_CATALOG.filter((w) => w.id !== kindOf).map((w) => {
          const i = w.interests[0];
          const on = also.includes(i);
          return (
            <Tap
              key={w.id}
              onPress={() => setAlso((cur) => (on ? cur.filter((x) => x !== i) : cur.length < 3 ? [...cur, i] : cur))}
              style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', borderWidth: 1, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface }}
              accessibilityLabel={`Also about ${w.title}${on ? ', selected' : ''}`}
            >
              <T v="footnote" weight="600" color={on ? colors.accent : colors.ink2}>
                {w.title}
              </T>
            </Tap>
          );
        })}
      </View>
      <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
        COVER
      </T>
      <PhotoPicker images={cover ? [cover] : []} onPick={pick} onRemove={() => setCover(null)} max={1} />
      <T v="label" color={colors.inkFaint} style={{ marginBottom: 8 }}>
        WHO CAN SEE IT
      </T>
      <Segments
        value={visibility}
        onChange={setVisibility}
        options={[
          { id: 'private', label: 'Private' },
          { id: 'connections', label: 'Connections' },
          { id: 'public', label: 'Public' },
        ]}
      />
      <T v="caption" color={colors.inkFaint}>
        {visibility === 'public'
          ? 'Anyone on Chimp can find it and follow it. People ask to join; you approve.'
          : visibility === 'connections'
            ? 'Your connections can find it and ask to join. Nobody else sees it.'
            : 'Only you and the people you add can see it.'}
      </T>
    </Composer>
  );
}
