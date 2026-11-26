import React from 'react';
import { t } from './preferences.js';
export function DemoBanner(): React.JSX.Element {
 return <div className="demo-banner" role="status"><strong>{t('DEMO MODE')}</strong><span>{t('Demonstration only — sales appear only in the temporary demo history. Demo tickets and vouchers become invalid when demo mode ends. Do not collect real payments.')}</span></div>;
}
