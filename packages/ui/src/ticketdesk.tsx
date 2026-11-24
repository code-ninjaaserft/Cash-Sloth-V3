import React, { useEffect } from 'react';
import type { TicketdeskApi } from '@cash-sloth/contracts';
import { TicketsView } from './tickets-view.js';
import { DemoBanner } from './demo-banner.js';
import { t, useAppearance, usePreferences } from './preferences.js';
export function Ticketdesk({ api, demoMode }: { api: TicketdeskApi | undefined; demoMode: boolean }): React.JSX.Element {
 useAppearance(); const { locale }=usePreferences();
 useEffect(() => { document.title=t('Ticketdesk'); }, [locale]);
 return <div className="ticketdesk-window">{demoMode && <DemoBanner />}{api ? <TicketsView api={api} title="Ticketdesk" recoveryKey="cash-sloth.ticketdesk-redemption.v1" /> : <p role="alert">{t('Tickets are unavailable on this host.')}</p>}</div>;
}
