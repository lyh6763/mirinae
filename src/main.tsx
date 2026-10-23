import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nanum-myeongjo/700.css';
import '@fontsource/nanum-myeongjo/800.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
