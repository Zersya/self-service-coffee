import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import Admin from './pages/Admin.tsx';
import './index.css';

const path = window.location.pathname;

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    {path === '/admin' ? <Admin /> : <App />}
  </StrictMode>,
);
