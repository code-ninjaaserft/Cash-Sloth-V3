import React, { useCallback, useEffect, useState } from 'react';
import type { CashSlothApi, SystemInfo } from '@cash-sloth/contracts';
import { foundationMessages as messages } from '@cash-sloth/i18n';

export function FoundationStatus({ api, logo, showBranding = true }: {
  api: CashSlothApi | undefined;
  logo: { src: string; srcSet: string };
  showBranding?: boolean;
}): React.JSX.Element {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async (): Promise<void> => {
    if (api === undefined) return;
    setBusy(true);
    setFailed(false);
    try {
      setInfo(await api.system.getInfo());
    } catch {
      setInfo(null);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <>
    {showBranding && <header className="app-brand" aria-label="Cash Sloth V3">
      <img src={logo.src} srcSet={logo.srcSet} alt="Cash Sloth V3 logo" width={72} height={72} />
      <span>Cash Sloth V3</span>
    </header>}
    <main>
      <p className="eyebrow">{messages.milestone}</p>
      <h1>{messages.title}</h1>
      <p className="intro">{messages.introduction}</p>
      <section className="status-card" aria-labelledby="runtime-heading">
        <h2 id="runtime-heading">{messages.statusTitle}</h2>
        {api === undefined && <p role="alert">{messages.unavailable}</p>}
        {failed && <p role="alert">{messages.failed}</p>}
        <p role="status">{busy ? messages.checking : info === null ? '' : messages.connected}</p>
        {info !== null && (
          <dl data-testid="system-info">
            <dt>Host</dt><dd>{info.host}</dd>
            <dt>Channel</dt><dd>{info.channel}</dd>
            <dt>Application</dt><dd>{info.appVersion}</dd>
            <dt>Node.js</dt><dd>{info.versions.node}</dd>
            <dt>Electron</dt><dd>{info.versions.electron ?? '—'}</dd>
            <dt>SQLite</dt><dd>{info.sqliteVersion}</dd>
            <dt>Platform</dt><dd>{info.platform} / {info.arch}</dd>
          </dl>
        )}
        <button type="button" disabled={busy || api === undefined} onClick={() => { void refresh(); }}>
          {messages.refresh}
        </button>
      </section>
      <p className="notice">{messages.scope}</p>
    </main>
    </>
  );
}
