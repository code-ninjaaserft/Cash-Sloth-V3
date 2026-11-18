export interface NavigationOverlayState {
  phase: 'closed' | 'open' | 'closing';
  cycle: number;
  entriesReady: boolean;
}

type NavigationOverlayEvent = { type: 'set-expanded'; expanded: boolean } | { type: 'finish-close'; cycle: number } | { type: 'finish-open'; cycle: number } | { type: 'retarget' };

export function initialNavigationOverlay(expanded: boolean): NavigationOverlayState {
  return { phase: expanded ? 'open' : 'closed', cycle: 0, entriesReady: expanded };
}

/** Closing retains the interaction shield until the matching visual transition ends. */
export function navigationOverlayReducer(state: NavigationOverlayState, event: NavigationOverlayEvent): NavigationOverlayState {
  if (event.type === 'retarget') return state.phase === 'closing' || (state.phase === 'open' && !state.entriesReady) ? { ...state, cycle: state.cycle + 1 } : state;
  if (event.type === 'finish-close') return state.phase === 'closing' && event.cycle === state.cycle ? { ...state, phase: 'closed' } : state;
  if (event.type === 'finish-open') return state.phase === 'open' && event.cycle === state.cycle ? { ...state, entriesReady: true } : state;
  if (event.expanded) return state.phase === 'open' ? state : { phase: 'open', cycle: state.cycle + 1, entriesReady: false };
  return state.phase === 'open' ? { phase: 'closing', cycle: state.cycle + 1, entriesReady: false } : state;
}

/** CSS repeats shorter duration/delay lists; handle both seconds and milliseconds. */
export function transitionMilliseconds(durations: string, delays: string): number {
  const parse = (value: string): number => {
    const trimmed = value.trim();
    const number = Number.parseFloat(trimmed);
    return Number.isFinite(number) ? number * (trimmed.endsWith('ms') ? 1 : 1000) : 0;
  };
  const times = durations.split(',').map(parse);
  const waits = delays.split(',').map(parse);
  return Math.max(0, ...Array.from({ length: Math.max(times.length, waits.length) }, (_, index) => (times[index % times.length] ?? 0) + (waits[index % waits.length] ?? 0)));
}
