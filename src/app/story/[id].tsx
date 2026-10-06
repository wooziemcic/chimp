import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { StoryViewer } from '@/components/stories/StoryViewer';
import { EmptyState } from '@/components/ui/misc';
import { liveStory } from '@/graph/happeningNow';
import { isAfterDarkRef } from '@/graph/surfaces';
import { repo } from '@/services/repository';

/** Full-screen story route. `lane` decides what plays next. */
export default function StoryRoute() {
  const { id, lane } = useLocalSearchParams<{ id: string; lane?: 'trending' | 'friend' }>();
  // Phase 9: only what is still live (an item lives 24 h); an expired Story isn't shown.
  const [openedAt] = useState(() => Date.now());
  const raw = repo.story(id);
  const story = useMemo(() => (raw ? liveStory(raw, openedAt) : null), [raw, openedAt]);

  const queue = useMemo(() => {
    if (!story) return [];
    const l = lane ?? story.lane;
    // After Dark stays in its own territory: its stories never queue into
    // normal Drift, and normal stories never queue into After Dark.
    const night = isAfterDarkRef({ kind: 'story', id: story.id });
    const list = repo
      .stories()
      .filter((s) => s.lane === l && isAfterDarkRef({ kind: 'story', id: s.id }) === night)
      .map((s) => liveStory(s, openedAt))
      .filter((s): s is NonNullable<typeof s> => !!s);
    return list.some((s) => s.id === story.id) ? list : [story];
  }, [story, lane, openedAt]);

  if (!story) return <EmptyState title={raw ? 'This Story has expired' : 'Story not found'} />;

  return (
    // Modals get their own gesture root so pinch / hold work reliably.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <StoryViewer key={story.id} queue={queue} startIndex={Math.max(0, queue.findIndex((s) => s.id === story.id))} />
    </GestureHandlerRootView>
  );
}
