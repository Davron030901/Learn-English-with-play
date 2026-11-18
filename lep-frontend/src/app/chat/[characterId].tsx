import { Redirect, router, useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@/features/chat/ChatScreen';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/library');
}

/** /chat/[characterId]?unit=S01U03 — talk with a character about a unit's scenario (docs/16 E21). */
export default function ChatRoute() {
  const { characterId, unit } = useLocalSearchParams<{ characterId: string; unit?: string }>();
  if (!characterId || !unit || !/^S\d{2}U\d{2}$/.test(unit)) return <Redirect href="/library" />;
  return <ChatScreen characterId={characterId} unitId={unit} onBack={back} />;
}
