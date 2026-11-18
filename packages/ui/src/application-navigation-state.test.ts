import { describe, expect, it } from 'vitest';
import { initialNavigationOverlay, navigationOverlayReducer, transitionMilliseconds } from './application-navigation-state.js';

describe('application navigation overlay interaction lifecycle', () => {
  it('starts compact without an interaction shield', () => {
    expect(initialNavigationOverlay(false).phase).toBe('closed');
    expect(initialNavigationOverlay(true).phase).toBe('open');
  });

  it('opens directly and retains the shield throughout closing', () => {
    const open = navigationOverlayReducer(initialNavigationOverlay(false), { type: 'set-expanded', expanded: true });
    const closing = navigationOverlayReducer(open, { type: 'set-expanded', expanded: false });
    expect(open.phase).toBe('open');
    expect(closing.phase).toBe('closing');
    expect(navigationOverlayReducer(closing, { type: 'finish-close', cycle: closing.cycle }).phase).toBe('closed');
  });

  it('ignores a stale close timer after reopening', () => {
    const closing = navigationOverlayReducer(initialNavigationOverlay(true), { type: 'set-expanded', expanded: false });
    const reopened = navigationOverlayReducer(closing, { type: 'set-expanded', expanded: true });
    expect(navigationOverlayReducer(reopened, { type: 'finish-close', cycle: closing.cycle })).toBe(reopened);
  });

  it('keeps keyboard entries unavailable until the matching expansion finishes', () => {
    const open = navigationOverlayReducer(initialNavigationOverlay(false), { type: 'set-expanded', expanded: true });
    expect(open.entriesReady).toBe(false);
    expect(navigationOverlayReducer(open, { type: 'finish-open', cycle: open.cycle }).entriesReady).toBe(true);
    const closing = navigationOverlayReducer(open, { type: 'set-expanded', expanded: false });
    expect(navigationOverlayReducer(closing, { type: 'finish-open', cycle: open.cycle })).toBe(closing);
    expect(closing.entriesReady).toBe(false);
  });

  it('does not release a later close when an older transition completes', () => {
    const first = navigationOverlayReducer(initialNavigationOverlay(true), { type: 'set-expanded', expanded: false });
    const reopened = navigationOverlayReducer(first, { type: 'set-expanded', expanded: true });
    const second = navigationOverlayReducer(reopened, { type: 'set-expanded', expanded: false });
    expect(navigationOverlayReducer(second, { type: 'finish-close', cycle: first.cycle })).toBe(second);
    expect(navigationOverlayReducer(second, { type: 'finish-close', cycle: second.cycle }).phase).toBe('closed');
  });

  it('does not restart a close cycle on repeated controlled updates', () => {
    const compact = initialNavigationOverlay(false);
    expect(navigationOverlayReducer(compact, { type: 'set-expanded', expanded: false })).toBe(compact);
    const closing = navigationOverlayReducer(initialNavigationOverlay(true), { type: 'set-expanded', expanded: false });
    expect(navigationOverlayReducer(closing, { type: 'set-expanded', expanded: false })).toBe(closing);
  });

  it('restarts close completion protection when resizing retargets the surface', () => {
    const closing = navigationOverlayReducer(initialNavigationOverlay(true), { type: 'set-expanded', expanded: false });
    const resized = navigationOverlayReducer(closing, { type: 'retarget' });
    expect(resized.cycle).toBeGreaterThan(closing.cycle);
    expect(navigationOverlayReducer(resized, { type: 'finish-close', cycle: closing.cycle })).toBe(resized);
    expect(navigationOverlayReducer(resized, { type: 'finish-close', cycle: resized.cycle }).phase).toBe('closed');
  });

  it('does not expose keyboard entries through an expansion retargeted by resizing', () => {
    const opening = navigationOverlayReducer(initialNavigationOverlay(false), { type: 'set-expanded', expanded: true });
    const resized = navigationOverlayReducer(opening, { type: 'retarget' });
    expect(navigationOverlayReducer(resized, { type: 'finish-open', cycle: opening.cycle }).entriesReady).toBe(false);
    expect(navigationOverlayReducer(resized, { type: 'finish-open', cycle: resized.cycle }).entriesReady).toBe(true);
    const compact = initialNavigationOverlay(false);
    expect(navigationOverlayReducer(compact, { type: 'retarget' })).toBe(compact);
  });

  it('uses the longest visual duration including repeated CSS delay lists', () => {
    expect(transitionMilliseconds('260ms', '0s')).toBe(260);
    expect(transitionMilliseconds('0.22s, 100ms', '20ms')).toBe(240);
    expect(transitionMilliseconds('100ms', '0s, 0.15s')).toBe(250);
  });

  it('handles disabled/reduced-motion transitions and negative delays', () => {
    expect(transitionMilliseconds('0s', '0s')).toBe(0);
    expect(transitionMilliseconds('0.01ms', '0s')).toBe(0.01);
    expect(transitionMilliseconds('260ms', '-0.1s')).toBe(160);
    expect(transitionMilliseconds('0s', '-1s')).toBe(0);
  });

  it('avoids an unbounded shield if no computed transition is available', () => {
    expect(transitionMilliseconds('', '')).toBe(0);
    expect(transitionMilliseconds('initial', 'unset')).toBe(0);
  });
});
