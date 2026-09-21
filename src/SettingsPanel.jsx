import { useState } from 'react';
import { DEFAULT_SETTINGS, SETTING_GROUPS } from './city/settings.js';
import { COLOR_SCHEMES } from './city/colorSchemes.js';

function SlidersIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h8m4 0h4M4 17h3m4 0h9" /><circle cx="14" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>;
}

export function SettingsPanel({ settings, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className={`settings ${open ? 'is-open' : ''}`} aria-label="Настройки города">
      <button className="settings-toggle" aria-expanded={open} aria-controls="city-settings" onClick={() => setOpen(!open)}>
        <span className="settings-toggle-icon"><SlidersIcon /></span>
        <span>Настройки города</span>
        <span className="settings-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div id="city-settings" className="settings-body">
        <p className="settings-intro">Такси лихачат всегда. Добавь ещё драйва.</p>
        <label className="setting palette-setting" htmlFor="setting-colorScheme">
          <span className="setting-label">Цветовая гамма</span>
          <select id="setting-colorScheme" value={settings.colorScheme}
            onChange={event => onChange({ ...settings, colorScheme: event.target.value })}>
            {Object.entries(COLOR_SCHEMES).map(([value, scheme]) => <option key={value} value={value}>{scheme.label}</option>)}
          </select>
        </label>
        <button className="palette-preview" onClick={() => onChange({
          ...settings, colorScheme: settings.colorScheme === 'classic' ? 'pale' : 'classic',
        })}>
          {settings.colorScheme === 'classic' ? 'Плавно к блёклой →' : '← Плавно к исходной'}
        </button>
        <p className="palette-preview-note">Тест перехода 0 ↔ 84% · 1,2 секунды</p>
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
            <span aria-hidden="true">{settings.paused ? '▶' : 'Ⅱ'}</span> {settings.paused ? 'Продолжить' : 'Пауза'}
          </button>
          <button className="reset-button" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>Сбросить</button>
        </div>
        <p className="settings-note">Настройки запоминаются на этом устройстве</p>
      </div>}
    </aside>
  );
}
