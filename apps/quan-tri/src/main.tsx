import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Application } from './Application.js';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Không tìm thấy phần tử gốc');
}

createRoot(rootElement).render(
  <StrictMode>
    <Application />
  </StrictMode>,
);
