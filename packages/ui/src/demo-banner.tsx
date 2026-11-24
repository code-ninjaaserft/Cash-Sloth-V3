import React from 'react';
import { t } from './preferences.js';
export function DemoBanner(): React.JSX.Element {
 return <div className="demo-banner" role="status"><strong>{t('DEMO MODE')}</strong><span>{t('Demonstration only — sales do not count towards history or revenue. Do not collect real payments.')}</span></div>;
}
