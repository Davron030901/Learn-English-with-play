import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';

import type { ShopOut } from '@/api/types';
import type { Course, Unit } from '@/content/model';
import { ContentRepository } from '@/content/repository';
import type { Item } from '@/content/schemas';
import { AssessmentRunner, type AssessmentAnswer, type AssessmentMode } from '@/features/assessment/AssessmentRunner';
import { sectionNumber } from '@/features/assessment/Placement';
import { itemsById } from '@/features/assessment/useItems';
import { ShopScreen } from '@/features/shop/ShopScreen';
import { getOutbox } from '@/outbox';
import { EMPTY_LEARNER, useLearner } from '@/state/learner';

import { fsContentSource } from '../support/fsSource';
import { answer } from './drive';
import { newQueryClient, renderUI } from './render';

/**
 * The two assessments and the shop (docs/16 E14, E17, E20): a test-out shows feedback and stores
 * every answer under the checkpoint's id; placement shows no verdict and stores nothing; the shop
 * sells looks only and never lets a balance go below zero.
 */

const repo = new ContentRepository(fsContentSource);
let unit: Unit;
let course: Course;
let words: ReadonlySet<string>;
let n = 0;
let learnerId = '';

const AUTO = new Set(['mcq_word_from_definition', 'gap_fill_bank', 'type_from_l1', 'odd_one_out', 'grammaticality_judgement', 'word_bank_build']);

beforeAll(async () => {
  [unit, course, words] = await Promise.all([repo.loadUnit('S01U01'), repo.loadCourse(), repo.loadWords()]);
});

beforeEach(async () => {
  await AsyncStorage.clear();
  n += 1;
  learnerId = `learner-a${n}`;
  useLearner.setState({ learnerId, data: { ...EMPTY_LEARNER, profile: { l1: 'uz', spellingVariant: 'us' } }, loaded: true });
});

function pick(count: number): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const it of itemsById(unit).values()) {
    if (AUTO.has(it.type_id) && !seen.has(it.type_id)) {
      seen.add(it.type_id);
      out.push(it);
    }
    if (out.length === count) break;
  }
  return out;
}

async function run(mode: AssessmentMode, items: Item[], wrongAt = -1) {
  const onFinish = jest.fn<void, [AssessmentAnswer[]]>();
  const onLeave = jest.fn();
  await renderUI(
    <AssessmentRunner items={items} units={new Map([[unit.id, unit]])} words={words} course={course} mode={mode} sessionId="chk-1" onFinish={onFinish} onLeave={onLeave} />,
  );
  for (let i = 0; i < items.length; i++) {
    const handled = await answer(items[i] as Item, i === wrongAt);
    if (!handled) throw new Error(`no driver for ${items[i]?.type_id}`);
    if (mode === 'testOut') await fireEvent.press(screen.getByTestId('feedback-continue'));
    else expect(screen.queryByTestId('feedback-continue')).toBeNull();
  }
  return { onFinish, onLeave };
}

test('a test-out gives feedback and stores every answer under the checkpoint id', async () => {
  const items = pick(4);
  expect(items.length).toBeGreaterThanOrEqual(3);
  const { onFinish } = await run('testOut', items, 1);
  expect(onFinish).toHaveBeenCalledTimes(1);
  const answers = onFinish.mock.calls[0]?.[0] ?? [];
  expect(answers.map((a) => a.itemId)).toEqual(items.map((i) => i.id));
  expect(answers[1]?.verdict).toBe('incorrect');
  const stored = await getOutbox(learnerId).list();
  const reviews = stored.filter((r) => r.kind === 'review');
  expect(reviews).toHaveLength(items.length);
  for (const r of reviews) {
    const payload = r.payload as { session_id: string; hints_used: number };
    expect(payload.session_id).toBe('chk-1');
    expect(payload.hints_used).toBe(0);
  }
});

test('an exam shows no verdict until the end, but stores every answer under the exam id', async () => {
  const items = pick(3);
  const { onFinish } = await run('exam', items, 0);
  expect(screen.queryByTestId('hint')).toBeNull();
  expect(onFinish).toHaveBeenCalledTimes(1);
  const reviews = (await getOutbox(learnerId).list()).filter((r) => r.kind === 'review');
  expect(reviews).toHaveLength(items.length);
  for (const r of reviews) expect((r.payload as { session_id: string }).session_id).toBe('chk-1');
  // the wrong first answer is stored as the device graded it; nothing was shown
  expect((reviews[0]?.payload as { local_verdict: string }).local_verdict).toBe('incorrect');
});

test('placement shows no verdict, offers no hint and writes nothing to the outbox', async () => {
  const items = pick(3);
  const { onFinish } = await run('placement', items);
  expect(screen.queryByTestId('hint')).toBeNull();
  expect(onFinish).toHaveBeenCalledTimes(1);
  expect(onFinish.mock.calls[0]?.[0]).toHaveLength(items.length);
  expect(await getOutbox(learnerId).list()).toHaveLength(0);
});

test('leaving asks first and keeps the answers', async () => {
  const items = pick(3);
  const onLeave = jest.fn();
  await renderUI(
    <AssessmentRunner items={items} units={new Map([[unit.id, unit]])} words={words} course={course} mode="testOut" sessionId="chk-2" onFinish={jest.fn()} onLeave={onLeave} />,
  );
  await fireEvent.press(screen.getByTestId('lesson-close'));
  expect(screen.getByTestId('assessment-leave-dialog')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('assessment-stay'));
  expect(onLeave).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('lesson-close'));
  await fireEvent.press(screen.getByTestId('assessment-leave'));
  expect(onLeave).toHaveBeenCalledTimes(1);
});

test('a placement result points at its section, or Section 1 when unknown', () => {
  const second = course.sections[1];
  expect(second).toBeTruthy();
  expect(sectionNumber(course, second?.id)).toBe(2);
  expect(sectionNumber(course, null)).toBe(1);
});

// ------------------------------------------------------------------- the shop

const SHOP: ShopOut = {
  gems: 70,
  note: 'Gems buy looks only',
  items: [
    { id: 'outfit.round_glasses', kind: 'pip_outfit', price: 50, name: { en: 'Round glasses', uz: "Dumaloq ko'zoynak", ru: 'Круглые очки' }, owned: true, equipped: true },
    { id: 'outfit.doppi', kind: 'pip_outfit', price: 60, name: { en: 'Doppi', uz: "Do'ppi", ru: 'Тюбетейка' }, owned: false, equipped: false },
    { id: 'outfit.astronaut', kind: 'pip_outfit', price: 300, name: { en: 'Astronaut helmet', uz: 'Kosmonavt', ru: 'Шлем' }, owned: false, equipped: false },
    { id: 'theme.chorsu', kind: 'theme', price: 120, name: { en: 'Chorsu bazaar', uz: 'Chorsu', ru: 'Чорсу' }, owned: false, equipped: false },
    { id: 'path.mountains', kind: 'path_skin', price: 200, name: { en: 'Chimgan mountains', uz: 'Chimyon', ru: 'Чимган' }, owned: false, equipped: false },
  ],
};

async function showShop() {
  const client = newQueryClient();
  client.setQueryData(['shop'], SHOP);
  await renderUI(<ShopScreen onBack={jest.fn()} />, client);
}

test('the shop shows the server balance and says gems buy looks only', async () => {
  await showShop();
  expect(screen.getByTestId('shop-balance').props.accessibilityLabel).toBe('70 gems');
  expect(screen.getByText(/never lessons, hints, streak freezes or tests/)).toBeTruthy();
  expect(screen.getByText('Outfits for Pip')).toBeTruthy();
  expect(screen.getByText('App themes')).toBeTruthy();
  expect(screen.getByText('Path styles')).toBeTruthy();
  expect(screen.getByText('Wearing')).toBeTruthy();
});

test('an item the balance cannot cover cannot be bought, and says how many gems are missing', async () => {
  await showShop();
  const short = screen.getByTestId('shop-buy-outfit.astronaut');
  expect(short.props.accessibilityLabel).toBe('230 more gems');
  expect(short.props.accessibilityState?.disabled).toBe(true);
});

test('buying asks first, with what will be left', async () => {
  await showShop();
  await fireEvent.press(screen.getByTestId('shop-buy-outfit.doppi'));
  expect(screen.getByTestId('shop-confirm')).toBeTruthy();
  expect(screen.getByText('Doppi for 60 gems?')).toBeTruthy();
  expect(screen.getByText(/You will have 10 gems left/)).toBeTruthy();
});
