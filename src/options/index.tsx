import { createRoot } from 'react-dom/client';
import '@src/ui/index.css';
import { watchSystemTheme } from '@src/ui/theme';
import { installTestHook } from '@src/side-panel/test-hook';
import { App } from './App';

const container = document.querySelector('#app-container');
if (!container) throw new Error('Cannot find #app-container');
watchSystemTheme();
installTestHook(0, 'options');
createRoot(container).render(<App />);
