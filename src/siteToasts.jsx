import React from 'react';
import { createRoot } from 'react-dom/client';
import toast, { Toaster } from 'react-hot-toast';

const hostId = 'fare-site-toasts';

if (typeof document !== 'undefined' && !document.getElementById(hostId)) {
  const host = document.createElement('div');
  host.id = hostId;
  document.body.appendChild(host);
  createRoot(host).render(
    <Toaster
      position="top-right"
      gutter={10}
      toastOptions={{
        duration: 5_000,
        style: {
          maxWidth: '520px',
          padding: '15px 17px',
          border: '1px solid #293552',
          borderRadius: '12px',
          background: '#12192b',
          boxShadow: '0 20px 55px rgba(0, 0, 0, 0.48)',
          color: '#eef2ff',
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: '13px',
          lineHeight: '1.45',
        },
        success: {
          duration: 5_000,
          iconTheme: { primary: '#68d9c0', secondary: '#12192b' },
          style: { borderColor: '#307d6d' },
        },
        error: {
          duration: 9_000,
          iconTheme: { primary: '#ff6978', secondary: '#12192b' },
          style: { borderColor: '#ff6978' },
        },
        loading: {
          duration: Infinity,
          iconTheme: { primary: '#ffe52c', secondary: '#12192b' },
          style: { borderColor: '#ffe52c' },
        },
      }}
    />,
  );
}

export const notifySuccess = (message, options) => toast.success(message, options);
export const notifyError = (message, options) => toast.error(message, options);
export const notifyLoading = (message, options) => toast.loading(message, options);
export const dismissToast = id => toast.dismiss(id);
