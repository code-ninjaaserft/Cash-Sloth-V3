import React, { useState } from 'react';
import type { TicketdeskControlApi } from '@cash-sloth/contracts';
export function TicketdeskButton({ api, translate: t }: { api: TicketdeskControlApi | undefined; translate: (value: string) => string }): React.JSX.Element {
 const [busy,setBusy]=useState(false), [notice,setNotice]=useState<string|null>(null);
 return <div><button type="button" className="subtle-button" disabled={!api || busy} onClick={() => {
  if (!api || busy) return; setBusy(true); setNotice(null);
  void api.open({}).then(result => { if (!result.ok) throw new Error(result.error.message); setNotice(t('Ticketdesk opened. Move the window to the ticket station.')); }).catch(() => setNotice(t('The ticketdesk could not be opened. Try again.'))).finally(() => setBusy(false));
 }}>{t('Open ticketdesk')}</button>{notice && <p role="status">{notice}</p>}</div>;
}
