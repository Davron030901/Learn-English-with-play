import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';

import { serverHasShop, useEquip, usePurchase, useShop } from '@/api/queries/assessment';
import type { ShopItemOut } from '@/api/types';
import { sfx } from '@/audio/sfx';
import { Button, Card, Chip, Icon, Notice, PendingStat, Screen, ScreenHeader, SectionTitle, Txt, radius, useTheme } from '@/design';
import { CosmeticSwatch, DressedPip } from '@/design/Outfits';
import { ProblemNotice, asProblem } from '@/features/errors';
import { usePrefs } from '@/state/prefs';

const KINDS = ['pip_outfit', 'theme', 'path_skin'] as const;
type Kind = (typeof KINDS)[number];

export function itemName(item: Pick<ShopItemOut, 'name' | 'id'>, language: string): string {
  return item.name[language] ?? item.name.en ?? item.id;
}

/**
 * Pip's shop (docs/16 E17, docs/10 §9): gems the learner earned buy looks — Pip's outfits, app
 * themes and path skins — and nothing else. No lessons, hints, freezes or tests are for sale and
 * nothing is "limited time". Trying an outfit on is free; the balance comes from the server.
 */
export function ShopScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = usePrefs((s) => s.interfaceLanguage);
  const shop = useShop();
  const purchase = usePurchase();
  const equip = useEquip();
  const [tryOn, setTryOn] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ShopItemOut | null>(null);

  const items = shop.data?.items;
  const byKind = useMemo(() => {
    const out = new Map<Kind, ShopItemOut[]>(KINDS.map((k) => [k, []]));
    for (const it of items ?? []) out.get(it.kind)?.push(it);
    for (const list of out.values()) list.sort((a, b) => a.price - b.price);
    return out;
  }, [items]);
  const wearing = items?.find((i) => i.kind === 'pip_outfit' && i.equipped)?.id ?? null;
  const shown = tryOn ?? wearing;
  const gems = shop.data?.gems ?? 0;

  const buy = (item: ShopItemOut) => {
    setConfirm(null);
    purchase.mutate(item.id, {
      onSuccess: () => {
        sfx('gem');
        // A new outfit goes on straight away; a theme or skin waits to be chosen.
        if (item.kind === 'pip_outfit') equip.mutate(item.id);
      },
    });
  };

  const header = <ScreenHeader title={t('shop.title')} onBack={onBack} backLabel={t('common.back')} />;

  if (!serverHasShop) {
    return (
      <Screen header={header} testID="shop">
        <PendingStat icon="gem" tone="gem" title={t('shop.title')} body={t('shop.unavailable')} />
      </Screen>
    );
  }

  return (
    <Screen header={header} testID="shop">
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <DressedPip outfit={shown} pose={tryOn ? 'cheer' : 'happy'} size={112} label={t('shop.pipLabel')} />
          <View style={{ flex: 1, gap: 6 }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              accessible
              accessibilityLabel={t('shop.balanceLabel', { count: gems })}
              testID="shop-balance"
            >
              <Icon name="gem" tone="color" size={28} />
              <Txt variant="display-m">{shop.data ? String(gems) : '–'}</Txt>
            </View>
            <Txt variant="body-s" color="ink-3">
              {t('shop.earnHow')}
            </Txt>
            {tryOn && tryOn !== wearing ? (
              <Button size="sm" variant="ghost" onPress={() => setTryOn(null)} testID="shop-take-off">
                {t('shop.takeOff')}
              </Button>
            ) : null}
          </View>
        </View>
      </Card>

      <Notice icon="shield" tone="lagoon">
        {t('shop.looksOnly')}
      </Notice>

      {shop.error ? <ProblemNotice problem={asProblem(shop.error)} onRetry={() => void shop.refetch()} /> : null}
      {purchase.error ? <ProblemNotice problem={asProblem(purchase.error)} onRetry={() => purchase.reset()} /> : null}
      {!shop.data && !shop.error ? <Txt color="ink-3">{t('common.loading')}</Txt> : null}

      {shop.data
        ? KINDS.map((kind) => (
            <View key={kind} style={{ gap: 10 }}>
              <SectionTitle>{t(`shop.kind.${kind}`)}</SectionTitle>
              {kind !== 'pip_outfit' ? (
                <Txt variant="body-s" color="ink-3">
                  {t(`shop.kindNote.${kind}`)}
                </Txt>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {(byKind.get(kind) ?? []).map((item) => {
                  const name = itemName(item, language);
                  const short = Math.max(0, item.price - gems);
                  const selected = kind === 'pip_outfit' && shown === item.id;
                  return (
                    <View
                      key={item.id}
                      testID={`shop-item-${item.id}`}
                      style={{
                        flexBasis: '46%',
                        flexGrow: 1,
                        minWidth: 140,
                        backgroundColor: theme.c.surface,
                        borderWidth: 2,
                        borderColor: selected || item.equipped ? theme.c.primary : theme.c.line,
                        borderRadius: radius.lg,
                        padding: 12,
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      <Pressable
                        onPress={kind === 'pip_outfit' ? () => setTryOn(item.id) : undefined}
                        disabled={kind !== 'pip_outfit'}
                        accessibilityRole={kind === 'pip_outfit' ? 'button' : undefined}
                        accessibilityLabel={kind === 'pip_outfit' ? t('shop.tryOnLabel', { name }) : name}
                      >
                        {kind === 'pip_outfit' ? <DressedPip outfit={item.id} size={84} /> : <CosmeticSwatch id={item.id} size={84} />}
                      </Pressable>
                      <Txt variant="title-s" align="center" numberOfLines={2}>
                        {name}
                      </Txt>
                      {item.equipped ? (
                        <Chip tone="success" icon="check" size="sm">
                          {kind === 'pip_outfit' ? t('shop.wearing') : t('shop.inUse')}
                        </Chip>
                      ) : item.owned ? (
                        <Button size="sm" variant="secondary" busy={equip.isPending && equip.variables === item.id} onPress={() => equip.mutate(item.id)} testID={`shop-equip-${item.id}`}>
                          {kind === 'pip_outfit' ? t('shop.wear') : t('shop.use')}
                        </Button>
                      ) : (
                        <>
                          <Chip tone="gem" icon="gem" size="sm">
                            {String(item.price)}
                          </Chip>
                          <Button
                            size="sm"
                            variant={short === 0 ? 'gold' : 'secondary'}
                            disabled={short > 0}
                            busy={purchase.isPending && purchase.variables === item.id}
                            onPress={() => setConfirm(item)}
                            accessibilityLabel={short > 0 ? t('shop.needMore', { count: short }) : t('shop.buyLabel', { name, price: item.price })}
                            testID={`shop-buy-${item.id}`}
                          >
                            {short > 0 ? t('shop.needMore', { count: short }) : t('shop.buy')}
                          </Button>
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        : null}

      {confirm ? (
        <Modal transparent visible animationType={theme.reduceMotion ? 'none' : 'fade'} onRequestClose={() => setConfirm(null)}>
          <View style={{ flex: 1, backgroundColor: theme.c.scrim, justifyContent: 'center', padding: 20 }}>
            <View
              accessibilityViewIsModal
              testID="shop-confirm"
              style={{ width: '100%', maxWidth: 400, alignSelf: 'center', backgroundColor: theme.c.surface, borderRadius: radius.xl, padding: 22, gap: 14, alignItems: 'center' }}
            >
              {confirm.kind === 'pip_outfit' ? <DressedPip outfit={confirm.id} pose="cheer" size={110} /> : <CosmeticSwatch id={confirm.id} size={96} />}
              <Txt variant="title-l" align="center" accessibilityRole="header">
                {t('shop.confirmTitle', { name: itemName(confirm, language), price: confirm.price })}
              </Txt>
              <Txt variant="body-m" color="ink-2" align="center">
                {t('shop.confirmBody', { left: gems - confirm.price })}
              </Txt>
              <Button block variant="gold" icon="gem" onPress={() => buy(confirm)} testID="shop-confirm-buy">
                {t('shop.buy')}
              </Button>
              <Button block variant="ghost" onPress={() => setConfirm(null)}>
                {t('shop.notNow')}
              </Button>
            </View>
          </View>
        </Modal>
      ) : null}
    </Screen>
  );
}
