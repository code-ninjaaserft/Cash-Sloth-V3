import React, { useRef, useState } from 'react';
import { prepareCustomLogo, type CustomLogo } from './custom-logo.js';
import { t } from './preferences.js';

export function PresetLogoPicker({ value, legacyLogo, disabled, onChange, onBusyChange }: {
  value: CustomLogo | null; legacyLogo?: CustomLogo | undefined; disabled: boolean; onChange: (logo: CustomLogo | null) => void; onBusyChange: (busy: boolean) => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return <div className="preset-logo-picker">
    <h3>{t('Preset logo')}</h3><p className="form-hint">{t('This logo is saved with this preset and shown on the register and customer display.')}</p>
    <p className="form-hint">{t('PNG, JPG or WebP, up to 10 MB. A copy is saved on this device.')}</p>
    {value && <div className="custom-logo-preview"><img src={value.dataUrl} alt={t('Custom logo preview')} /><span>{value.name}</span></div>}
    <input ref={input} hidden type="file" aria-label={t('Logo image file')} accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      onBusyChange(true); setError(null);
      void prepareCustomLogo(file).then(onChange).catch((failure: unknown) => setError(failure instanceof Error ? t(failure.message) : t('The image could not be read.'))).finally(() => onBusyChange(false));
    }} />
    <div className="form-actions"><button type="button" className="subtle-button" disabled={disabled} onClick={() => input.current?.click()}>{t(value ? 'Replace logo' : 'Choose logo')}</button>{value && <button type="button" className="subtle-button" disabled={disabled} onClick={() => { onChange(null); setError(null); }}>{t('Remove logo')}</button>}{legacyLogo && !value && <button type="button" className="subtle-button" disabled={disabled} onClick={() => { onChange(legacyLogo); setError(null); }}>{t('Use previously selected logo')}</button>}</div>
    {error && <p role="alert" className="pos-error">{error}</p>}
  </div>;
}
