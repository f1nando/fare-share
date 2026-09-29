import { useState } from 'react';
import { DEFAULT_SETTINGS, SETTING_GROUPS } from './city/settings.js';
import { COLOR_SCHEMES } from './city/colorSchemes.js';

function SlidersIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h8m4 0h4M4 17h3m4 0h9" /><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>;
}

export function SettingsPanel({ settings, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={`settings ${open ? 'is-open' : ''}`} aria-label="City settings">
      <button className="settings-toggle" aria-expanded={open} aria-controls="city-settings" onClick={() => setOpen(!open)}>
        <span className="settings-toggle-icon"><SlidersIcon /></span>
        <span>City settings</span>
        <span className="settings-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div id="city-settings" className="settings-body">
        <p className="settings-intro">Taxis always drive wild. Add even more action.</p>
        <label className="setting palette-setting" htmlFor="setting-colorScheme">
          <span className="setting-label">Color scheme</span>
          <select id="setting-colorScheme" value={settings.colorScheme}
            onChange={event => onChange({ ...settings, colorScheme: event.target.value })}>
            {Object.entries(COLOR_SCHEMES).map(([value, scheme]) => <option key={value} value={value}>{scheme.label}</option>)}
          </select>
        </label>
        <button className="palette-preview" onClick={() => onChange({
          ...settings, colorScheme: settings.colorScheme === 'classic' ? 'pale' : 'classic',
        })}>
          {settings.colorScheme === 'classic' ? 'Fade to soft gray →' : '← Return to classic'}
        </button>
        <p className="palette-preview-note">Transition preview 0 ↔ 84% · 1.2 seconds</p>
        {SETTING_GROUPS.map(group => <fieldset key={group.title}>
          <legend>{group.title}</legend>
          {group.controls.map(control => <label className="setting" key={control.key} htmlFor={`setting-${control.key}`}>
            <span className="setting-label">{control.label}<output htmlFor={`setting-${control.key}`}>{settings[control.key]}{control.unit}</output></span>
            <input id={`setting-${control.key}`} type="range" min={control.min} max={control.max} step={control.step} value={settings[control.key]}
              style={{ '--range-fill': `${(settings[control.key] - control.min) / (control.max - control.min) * 100}%` }}
              onChange={event => onChange({ ...settings, [control.key]: Number(event.target.value) })} />
          </label>)}
        </fieldset>)}
        <div className="settings-actions">
          <button className="pause-button" aria-pressed={settings.paused} onClick={() => onChange({ ...settings, paused: !settings.paused })}>
            <span aria-hidden="true">{settings.paused ? '▶' : 'Ⅱ'}</span> {settings.paused ? 'Resume' : 'Pause'}
          </button>
          <button className="reset-button" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>Reset</button>
        </div>
        <p className="settings-note">Settings are saved on this device</p>
      </div>}
    </aside>
  );
}
