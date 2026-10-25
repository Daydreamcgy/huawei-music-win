import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { APP_DISPLAY_NAME } from '../shared/app-name.mjs';
import './styles.css';

// 页面标题会覆盖 BrowserWindow 的 title，窗口标题栏与任务栏悬停都读这个值，
// 统一从 shared 取，避免「非官方」后缀在这里漏掉。
document.title = APP_DISPLAY_NAME;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
