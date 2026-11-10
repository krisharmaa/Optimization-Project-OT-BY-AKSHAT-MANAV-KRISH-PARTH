import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { GOOGLE_FONTS_URL } from './themes/fonts';
import './styles/app.css';
import './styles/poster.css';

(document.getElementById('gfonts') as HTMLLinkElement).href = GOOGLE_FONTS_URL;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
