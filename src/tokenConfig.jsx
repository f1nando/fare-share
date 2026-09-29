import { createContext, useContext, useEffect, useState } from 'react';

const API = String(import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
const EMPTY_TOKEN = Object.freeze({ configured: false, mint: null, ticker: null });
const TokenConfigContext = createContext(EMPTY_TOKEN);

export function TokenConfigProvider({ children }) {
  const [token, setToken] = useState(EMPTY_TOKEN);

  useEffect(() => {
    let active = true;
    fetch(`${API}/api/token`)
      .then(async response => {
        if (!response.ok) throw new Error(`Token configuration: HTTP ${response.status}`);
        return response.json();
      })
      .then(value => { if (active) setToken(value); })
      .catch(error => console.warn(error.message));
    return () => { active = false; };
  }, []);

  return <TokenConfigContext.Provider value={token}>{children}</TokenConfigContext.Provider>;
}

export function useTokenConfig() {
  return useContext(TokenConfigContext);
}

export function displayTicker(token) {
  return token.ticker || 'TOKEN';
}
