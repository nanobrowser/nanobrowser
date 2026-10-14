import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

const container = document.querySelector('#app-container');
if (!container) {
  throw new Error('Cannot find #app-container');
}
createRoot(container).render(<App />);
