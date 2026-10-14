import { createRoot } from 'react-dom/client';
import '@src/ui/index.css';
import { watchSystemTheme } from '@src/ui/theme';
import { App } from './App';

const container = document.querySelector('#app-container');
if (!container) throw new Error('Cannot find #app-container');
watchSystemTheme();
createRoot(container).render(<App />);
