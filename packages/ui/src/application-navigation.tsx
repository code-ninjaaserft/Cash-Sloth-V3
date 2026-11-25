import { t } from './preferences.js';
import React, { useId, useLayoutEffect, useReducer, useRef } from 'react';
import { initialNavigationOverlay, navigationOverlayReducer, transitionMilliseconds } from './application-navigation-state.js';

export type ApplicationView = 'pos' | 'catalog' | 'import' | 'sales' | 'reconciliation' | 'system' | 'development' | 'settings' | 'presets' | 'tickets' | 'team' | 'promotions' | 'orders';

const views: readonly { id: ApplicationView; label: string }[] = [
  { id: 'pos', label: 'POS' },
  { id: 'orders', label: 'Orders' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'promotions', label:'Vouchers & discounts' },
  { id: 'presets', label: 'Presets' },
  { id: 'team', label: 'Team consumption' },
  { id: 'tickets', label: 'Redeem tickets' },
  { id: 'import', label: 'Import' },
  { id: 'sales', label: 'Sales history' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'system', label: 'System status' },
  { id: 'development', label: 'Development tools' },
  { id: 'settings', label: 'Settings' },
];

/** A non-modal overlay: only the category controls it covers are made inert. */
export function ApplicationNavigation({ view, onNavigate, expanded, onExpandedChange, developmentAllowed, onInteractionBlockedChange }: {
  view: ApplicationView;
  onNavigate: (view: ApplicationView) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  developmentAllowed: boolean;
  onInteractionBlockedChange: (blocked: boolean) => void;
}): React.JSX.Element {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const entries = useRef<HTMLElement>(null);
  const pendingEntryFocus = useRef(false);
  const [state, dispatch] = useReducer(navigationOverlayReducer, expanded, initialNavigationOverlay);
  const latestState = useRef(state);
  latestState.current = state;
  const transitionTiming = useRef({ cycle: -1, startedAt: 0, duration: 0 });
  const phase = expanded ? 'open' : state.phase === 'closed' ? 'closed' : 'closing';

  useLayoutEffect(() => {
    dispatch({ type: 'set-expanded', expanded });
    if (!expanded) pendingEntryFocus.current = false;
    if (!expanded && entries.current?.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true });
  }, [expanded]);

  useLayoutEffect(() => {
    if (expanded && state.entriesReady && pendingEntryFocus.current) {
      pendingEntryFocus.current = false;
      if (document.activeElement === toggle.current) entries.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    }
  }, [expanded, state.entriesReady]);

  useLayoutEffect(() => {
    const container = root.current;
    const button = toggle.current;
    if (!container || !button) return;
    let previous = { x: 0, y: 0 };
    const measure = (): void => {
      const bounds = container.getBoundingClientRect();
      const compact = button.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const x = Math.min(1, compact.width / bounds.width);
      const y = Math.min(1, compact.height / bounds.height);
      if (Math.abs(previous.x - x) < 1e-9 && Math.abs(previous.y - y) < 1e-9) return;
      const first = previous.x === 0;
      const pane = surface.current;
      const snap = latestState.current.phase === 'closed' && pane !== null;
      if (snap) pane.style.transition = 'none';
      container.style.setProperty('--navigation-scale-x', String(x));
      container.style.setProperty('--navigation-scale-y', String(y));
      container.dataset.ready = 'true';
      previous = { x, y };
      if (snap) {
        // Resizing a compact button must not start an unshielded panel transition.
        pane.getBoundingClientRect();
        pane.style.removeProperty('transition');
      } else if (!first) dispatch({ type: 'retarget' });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container); observer.observe(button);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => { onInteractionBlockedChange(phase !== 'closed'); }, [phase, onInteractionBlockedChange]);
  useLayoutEffect(() => () => onInteractionBlockedChange(false), [onInteractionBlockedChange]);

  useLayoutEffect(() => {
    const closing = state.phase === 'closing' && !expanded;
    const opening = state.phase === 'open' && expanded && !state.entriesReady;
    if (!closing && !opening) return;
    const style = surface.current ? getComputedStyle(surface.current) : null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced || !style ? 0 : transitionMilliseconds(style.transitionDuration, style.transitionDelay);
    const cycle = state.cycle;
    transitionTiming.current = { cycle, startedAt: performance.now(), duration };
    // Transition events may not fire after resize, interruption or motion preference changes.
    const timer = window.setTimeout(() => dispatch({ type: closing ? 'finish-close' : 'finish-open', cycle }), duration === 0 ? 0 : duration + 40);
    return () => window.clearTimeout(timer);
  }, [state, expanded]);

  const close = (): void => {
    toggle.current?.focus({ preventScroll: true });
    onExpandedChange(false);
  };
  const shieldClosing = (event: React.SyntheticEvent): void => {
    if (phase === 'closing' && !(event.target instanceof Node && toggle.current?.contains(event.target))) {
      event.preventDefault(); event.stopPropagation();
    }
  };

  return <div ref={root} className="application-navigation" data-phase={phase} data-entries-ready={expanded && state.entriesReady}
    onPointerDownCapture={shieldClosing} onClickCapture={shieldClosing}
    onKeyDown={(event) => {
      if (event.key === 'Tab' && expanded && !state.entriesReady && event.target === toggle.current) {
        pendingEntryFocus.current = !event.shiftKey;
        if (!event.shiftKey) event.preventDefault();
      }
      if (event.key === 'Escape' && phase !== 'closed') {
        event.preventDefault(); event.stopPropagation(); close();
      }
    }}>
    <div ref={surface} className="application-nav-surface" aria-hidden="true" onTransitionEnd={(event) => {
      const timing = transitionTiming.current;
      if (event.target !== event.currentTarget || event.propertyName !== 'transform' || timing.cycle !== state.cycle) return;
      // Do not let a queued transition from a previous reversal release the current shield.
      if (performance.now() - timing.startedAt < Math.max(0, timing.duration - 16)) return;
      if (state.phase === 'closing' && !expanded) dispatch({ type: 'finish-close', cycle: state.cycle });
      else if (state.phase === 'open' && expanded && !state.entriesReady) dispatch({ type: 'finish-open', cycle: state.cycle });
    }} />
    <button ref={toggle} type="button" className="application-nav-toggle" aria-label={`${expanded ? t("Collapse") : t("Expand")} application navigation`} aria-expanded={expanded} aria-controls={panelId} onClick={() => onExpandedChange(!expanded)}>
      <span className="hamburger-icon" aria-hidden="true"><span className="hamburger-line" /><span className="hamburger-line" /><span className="hamburger-line" /></span>
    </button>
    <div className="application-nav-content"><nav ref={entries} id={panelId} className="pos-nav" aria-label={t("Application navigation")} aria-hidden={!expanded || !state.entriesReady} inert={!expanded || !state.entriesReady}>
      {views.filter((entry) => entry.id !== 'development' || developmentAllowed).map((entry) => <button key={entry.id} type="button" aria-current={view === entry.id ? 'page' : undefined} onClick={() => { close(); onNavigate(entry.id); }}>{t(entry.label)}</button>)}

    </nav></div>
  </div>;
}
