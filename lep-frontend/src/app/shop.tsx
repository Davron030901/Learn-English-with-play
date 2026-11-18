import { router } from 'expo-router';

import { ShopScreen } from '@/features/shop/ShopScreen';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** /shop — Pip's shop: looks for earned gems (docs/16 E17). */
export default function ShopRoute() {
  return <ShopScreen onBack={back} />;
}
