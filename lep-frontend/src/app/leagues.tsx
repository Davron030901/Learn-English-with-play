import { router } from 'expo-router';

import { LeagueScreen } from '@/features/leagues/LeagueScreen';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** /leagues — the opt-in weekly leagues (docs/16 E23). */
export default function LeaguesRoute() {
  return <LeagueScreen onBack={back} />;
}
