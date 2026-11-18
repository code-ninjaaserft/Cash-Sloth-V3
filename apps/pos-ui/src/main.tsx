import React from 'react';
import { createRoot } from 'react-dom/client';
import { PosApp } from '@cash-sloth/ui';
import './styles.css';
import logo from '../../../assets/branding/generated/cash-sloth-128.png';
import logo2x from '../../../assets/branding/generated/cash-sloth-256.png';

const root = document.getElementById('root');
if (root === null) throw new Error('Application root is missing');

createRoot(root).render(
  <React.StrictMode>
    <PosApp api={window.cashSloth} logo={{ src: logo, srcSet: `${logo} 1x, ${logo2x} 2x` }} />
  </React.StrictMode>,
);
