import { createContext, useContext, useEffect, useState } from 'react';
import { BACKEND_URL as API } from './backendUrl.js';
import { PUBLIC_HOLDING } from './buildMode.js';

const EMPTY_TOKEN = Object.freeze({ configured: false, mint: null, ticker: PUBLIC_HOLDING ? 'FARE' : null });
const TokenConfigContext = createContext(EMPTY_TOKEN);

export function TokenConfigProvider({ children }) {
  const [token, setToken] = useState(EMPTY_TOKEN);

  useEffect(() => {
    if (PUBLIC_HOLDING) return undefined;
    let active = true;
    let timer;
    let reading = false;
    const refresh = () => {
      if (reading) return;
      reading = true;
      window.clearTimeout(timer);
      fetch(`${API}/api/token`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(`Token configuration: HTTP ${response.status}`);
        return response.json();
      })
      .then(value => { if (active) setToken(value); })
      .catch(error => console.warn(error.message))
      .finally(() => {
        reading = false;
        if (active) timer = window.setTimeout(refresh, 15_000);
      });
    };
    const onVisibilityChange = () => { if (!document.hidden) refresh(); };
    refresh();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return <TokenConfigContext.Provider value={token}>{children}</TokenConfigContext.Provider>;
}

export function useTokenConfig() {
  return useContext(TokenConfigContext);
}

export function displayTicker(token) {
  return token.ticker || 'TOKEN';
}
