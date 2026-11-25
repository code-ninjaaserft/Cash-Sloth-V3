import note50 from './assets/cash-note-50.png';
import note200 from './assets/cash-note-200.png';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { OrderInfoBoard, KitchenBoard, Kiosk, Ticketdesk, CustomerDisplay, PosApp, configureOperationStorage } from '@cash-sloth/ui';
import './styles.css';
import logo from '../../../assets/branding/generated/cash-sloth-128.png';
import cashArtwork from './assets/cash-denominations.png';
import logo2x from '../../../assets/branding/generated/cash-sloth-256.png';

const root = document.getElementById('root');
if (root === null) throw new Error('Application root is missing');

const reactRoot = createRoot(root);
async function start(): Promise<void> {
  const query = new URLSearchParams(window.location.search);
  const mode = query.get('ticketdesk') === '1' ? await window.cashSlothTicketdesk?.getState({}) : query.get('customer') === '1' || query.get('kiosk') === '1' || query.get('orderinfo') === '1' || query.get('kitchen') === '1' ? null : await window.cashSloth?.demo?.getState({});
  configureOperationStorage(mode?.sessionId ?? null);
  reactRoot.render(
  <React.StrictMode key={mode?.sessionId ?? 'live'}>
    {query.get('orderinfo') === '1' ? <OrderInfoBoard api={window.cashSlothOrderInfo}/> : query.get('kitchen') === '1' ? <KitchenBoard api={window.cashSlothKitchen}/> : query.get('kiosk') === '1' ? <Kiosk api={window.cashSlothKiosk}/> : query.get('ticketdesk') === '1' ? <Ticketdesk api={window.cashSlothTicketdesk} demoMode={mode?.enabled ?? false} /> : query.get('customer') === '1' ? <CustomerDisplay api={window.cashSlothCustomer} logo={logo} /> : <PosApp demoMode={mode?.enabled ?? false} cashNoteArtwork={{ 5000: note50, 20000: note200 }} cashArtwork={cashArtwork} api={window.cashSloth} logo={{ src: logo, srcSet: `${logo} 1x, ${logo2x} 2x` }} />}
  </React.StrictMode>,
);
}
window.addEventListener('cash-sloth-mode-changed', () => { void start().catch(() => { root.textContent = 'Cash Sloth could not verify the operating mode. Please restart.'; }); });
void start().catch(() => { root.textContent = 'Cash Sloth could not verify the operating mode. Please restart.'; });
