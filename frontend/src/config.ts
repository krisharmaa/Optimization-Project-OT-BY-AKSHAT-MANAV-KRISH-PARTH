/// <reference types="vite/client" />

/** Where the Python backend is. Empty (development): same origin, forwarded by the Vite proxy. In a deployed build set
 *  VITE_API_URL to the backend's address, e.g. https://clockwork-api.onrender.com. */
export const API_ROOT = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}/api`;
