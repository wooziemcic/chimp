import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { StoryViewer } from '@/components/stories/StoryViewer';
import { EmptyState } from '@/components/ui/misc';
import { isAfterDarkRef } from '@/graph/surfaces';
import { repo } from '@/services/repository';

/** Full-screen story route. `lane` decides what plays next. */
export default function StoryRoute() {
  const { id, lane } = useLocalSearchParams<{ id: string; lane?: 'trending' | 'friend' }>();
  const story = repo.story(id);

  const queue = useMemo(() => {
    if (!story) return [];
    const l = lane ?? story.lane;
    // After Dark stays in its own territory: its stories never queue into
    // normal Drift, and normal stories never queue into After Dark.
    const night = isAfterDarkRef({ kind: 'story', id: story.id });
    const list = repo.stories().filter((s) => s.lane === l && isAfterDarkRef({ kind: 'story', id: s.id }) === night);
    return list.length ? list : [story];
  }, [story, lane]);

  if (!story) return <EmptyState title="Story not found" />;

  return (
    // Modals get their own gesture root so pinch / hold work reliably.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <StoryViewer key={story.id} queue={queue} startIndex={Math.max(0, queue.findIndex((s) => s.id === story.id))} />
    </GestureHandlerRootView>
  );
}
