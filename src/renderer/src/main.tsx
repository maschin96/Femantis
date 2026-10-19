import { createRoot } from 'react-dom/client';
import { App } from '../App';
import '../styles.css';

// macOS uses an inset title bar; the header reserves room for the window controls.
document.documentElement.dataset.platform = /Mac/.test(navigator.userAgent) ? 'mac' : 'other';

createRoot(document.getElementById('root')!).render(<App />);
