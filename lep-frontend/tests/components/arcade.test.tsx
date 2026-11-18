import { fireEvent, screen } from '@testing-library/react-native';

import { ContentRepository } from '@/content/repository';
import ArcadeScreen from '@/features/arcade/ArcadeScreen';
import { usePrefs } from '@/state/prefs';

import { fsContentSource } from '../support/fsSource';
import { newQueryClient, renderUI } from './render';

async function openGame(mode: 'meaning' | 'spelling' | 'listening') {
  const repository = new ContentRepository(fsContentSource);
  const client = newQueryClient();
  client.setQueryData(['content', 'course'], await repository.loadCourse());
  client.setQueryData(['content', 'unit', 'S01U01'], await repository.loadUnit('S01U01'));
  usePrefs.setState({ noAudio: false });
  await renderUI(<ArcadeScreen />, client);
  await fireEvent.press(screen.getByTestId(`mode-${mode}`));
  await fireEvent.press(screen.getByTestId('arcade-start'));
}

test('spelling checks a real answer and retries only missed words', async () => {
  await openGame('spelling');
  for (let i = 0; i < 10; i++) {
    await fireEvent.changeText(screen.getByTestId('arcade-answer'), 'deliberately wrong');
    await fireEvent.press(screen.getByText('Check answer'));
    expect(screen.getByText('A new word to remember')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('arcade-next'));
  }
  expect(screen.getByText('0 of 10 without hints')).toBeTruthy();
  await fireEvent.press(screen.getByText('Practise these words'));
  expect(screen.getByTestId('arcade-answer')).toBeTruthy();
  expect(screen.getByText('1 / 10')).toBeTruthy();
});

test('a revealed listening answer never counts as unaided recall', async () => {
  await openGame('listening');
  for (let i = 0; i < 10; i++) {
    await fireEvent.press(screen.getByText('Can’t hear? Show the word (hint)'));
    await fireEvent.press(screen.getByTestId('arcade-choice-0'));
    await fireEvent.press(screen.getByTestId('arcade-next'));
  }
  expect(screen.getByText('0 of 10 without hints')).toBeTruthy();
  expect(screen.getByText('Your words to revisit')).toBeTruthy();
});
