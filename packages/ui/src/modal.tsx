import React, { useEffect, useRef } from 'react';

export function Modal({ title, onClose, children, className = '', closeDisabled = false }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  closeDisabled?: boolean;
}): React.JSX.Element {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected && !previous.matches(':disabled') && previous.getClientRects().length > 0) previous.focus(); };
  }, []);
  return <div className="checkout-backdrop catalog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`checkout-dialog ${className}`} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!closeDisabled) onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.current?.querySelectorAll<HTMLElement>('button, input:not([type="hidden"]), select, textarea, summary, a[href], [tabindex="0"]') ?? []]
        .filter((control) => {
          if (!control.checkVisibility({ visibilityProperty: true }) || control.matches(':disabled') || control.closest('[inert]')) return false;
          // Closed details may retain descendant layout boxes in Chromium.
          // Only their first summary (and its controls) participates in Tab order.
          let closedDetails = control.parentElement?.closest('details:not([open])') ?? null;
          while (closedDetails) {
            const summary = closedDetails.querySelector(':scope > summary');
            if (!summary?.contains(control)) return false;
            closedDetails = closedDetails.parentElement?.closest('details:not([open])') ?? null;
          }
          return control.tabIndex >= 0 || control.matches('details > summary:first-of-type:not([tabindex])');
        });
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <div className="modal-heading"><h2>{title}</h2><button type="button" className="subtle-button" aria-label={`Close ${title}`} disabled={closeDisabled} onClick={onClose}>Close</button></div>
      {children}
    </section>
  </div>;
}
