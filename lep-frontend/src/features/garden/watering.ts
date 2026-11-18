import { create } from 'zustand';

/**
 * What the last watering (review session) touched, so the garden can play its watering
 * animation on exactly those plants once the server's numbers arrive. Memory only: a fact about
 * this visit ("you answered these"), never a count of anything the server decides.
 */
interface WateringState {
  last: { plants: readonly string[]; at: number } | null;
  record: (plants: readonly string[]) => void;
  clear: () => void;
}

export const useWatering = create<WateringState>()((set) => ({
  last: null,
  record: (plants) => set({ last: plants.length ? { plants: [...new Set(plants)], at: Date.now() } : null }),
  clear: () => set({ last: null }),
}));

/** The watering is "fresh" for a couple of minutes: long enough to come back and see it. */
export const WATERING_FRESH_MS = 2 * 60_000;
