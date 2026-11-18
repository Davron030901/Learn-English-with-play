import { create } from 'zustand';

/**
 * One `online` state for the whole app (DECISIONS §7.5). Two inputs feed it: the platform's
 * network status (NetInfo, wired in the root layout) and whether the server actually answered
 * our last request (the transport). Either one saying "no" is enough to show the offline banner;
 * the next successful request clears it.
 */
interface OnlineState {
  network: boolean;
  serverReachable: boolean;
  setNetwork: (up: boolean) => void;
  setServerReachable: (up: boolean) => void;
}

export const useOnlineStore = create<OnlineState>((set) => ({
  network: true,
  serverReachable: true,
  setNetwork: (up) => set({ network: up }),
  setServerReachable: (up) => set({ serverReachable: up }),
}));

export const isOnline = (s: Pick<OnlineState, 'network' | 'serverReachable'>) => s.network && s.serverReachable;
