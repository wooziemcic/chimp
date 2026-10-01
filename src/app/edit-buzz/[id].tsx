import { useLocalSearchParams } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Composer, Input, WorldPicker, closeComposer } from '@/components/create/CreateParts';
import { Img } from '@/components/ui/Img';
import { EmptyState } from '@/components/ui/misc';
import { T } from '@/components/ui/Text';
import { isMyDemoBuzz, saveBuzzEdit } from '@/services/backend/ownContent';
import { repo } from '@/services/repository';
import { colors, radius } from '@/theme';

const MAX = 2000;

/**
 * Edit your Buzz (Phase 6D): the words and the World, within 1 hour of
 * posting. Photos and videos stay exactly as posted (delete and re-post to
 * change them). The server checks the author and the time; this screen just
 * shows its answer if the hour has passed.
 */
export default function EditBuzz() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = repo.buzzItem(id);
  const [body, setBody] = useState(item?.body ?? '');
  const [boardId, setBoardId] = useState<string | null>(item?.boardId ? item.boardId : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item || !((repo.mode() === 'real' && repo.isMe(item.authorId)) || isMyDemoBuzz(item.id))) return <EmptyState title="Nothing to edit" body="You can only edit your own posts." />;

  const media = item.video?.poster ?? item.image;
  const text = body.trim();
  const valid = (text.length > 0 || !!media) && text.length <= MAX;
  const changed = text !== (item.body ?? '').trim() || (boardId ?? '') !== (item.boardId ?? '');

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveBuzzEdit(item.id, text, boardId ?? '');
      closeComposer();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Composer title="Edit Buzz" action="Save" onAction={() => void save()} disabled={!valid || !changed} busy={busy} error={error}>
      <Input value={body} onChangeText={setBody} placeholder={media ? 'Add a caption' : 'What’s on your mind?'} multiline autoFocus max={MAX} counter testID="edit-buzz-body" />
      {media ? (
        <View style={styles.media}>
          <Img uri={media} style={styles.thumb} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Lock size={13} color={colors.inkMuted} />
              <T v="footnote" weight="700" color={colors.ink2} style={{ marginLeft: 5 }}>
                {item.video ? 'Video stays as posted' : (item.images?.length ?? 1) > 1 ? 'Photos stay as posted' : 'Photo stays as posted'}
              </T>
            </View>
            <T v="caption" color={colors.inkMuted} weight="400" style={{ marginTop: 3 }}>
              To change media, delete this post and post again.
            </T>
          </View>
        </View>
      ) : null}
      <WorldPicker value={boardId} onChange={setBoardId} label="World (optional)" allowNone />
      <T v="caption" color={colors.inkFaint} weight="400">
        Posts can be edited for 1 hour after posting. Everyone will see that it was edited.
      </T>
    </Composer>
  );
}

const styles = StyleSheet.create({
  media: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, marginBottom: 14 },
  thumb: { width: 56, height: 56, borderRadius: 12 },
});
