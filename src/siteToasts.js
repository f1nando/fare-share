import React from 'react';
import { createRoot } from 'react-dom/client';
import toast, { Toaster } from 'react-hot-toast';

const hostId = 'fare-site-toasts';

if (typeof document !== 'undefined' && !document.getElementById(hostId)) {
  const host = document.createElement('div');
  host.id = hostId;
  document.body.appendChild(host);
  createRoot(host).render(
    React.createElement(Toaster, {
      position: 'bottom-right',
      gutter: 12,
      containerStyle: { right: '20px', bottom: '20px' },
      toastOptions: {
        duration: 5_000,
        style: {
          maxWidth: '460px',
          padding: '15px 18px',
          border: '2px solid #111',
          borderRadius: '18px',
          background: '#fff',
          boxShadow: '5px 6px 0 #111',
          color: '#111',
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: '14px',
          fontWeight: '700',
          lineHeight: '1.45',
        },
        success: {
          duration: 5_000,
          iconTheme: { primary: '#111', secondary: '#ffe72f' },
          style: { background: '#ffe72f' },
        },
        error: {
          duration: 9_000,
          iconTheme: { primary: '#e5484d', secondary: '#fff' },
          style: { background: '#fff' },
        },
        loading: {
          duration: Infinity,
          iconTheme: { primary: '#ffe72f', secondary: '#111' },
          style: { color: '#fff', background: '#111', boxShadow: '5px 6px 0 #ffe72f' },
        },
      },
    }),
  );
}

export const notifySuccess = (message, options) => toast.success(message, options);
export const notifyError = (message, options) => toast.error(message, options);
export const notifyLoading = (message, options) => toast.loading(message, options);
export const notifyWarning = (message, options = {}) => toast(message, {
  duration: 7_000,
  icon: '⚠',
  ...options,
  style: {
    background: '#fff4c2',
    ...options.style,
  },
});
export const dismissToast = id => toast.dismiss(id);
