import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Evita que el scroll del mouse cambie el valor de un campo numérico enfocado,
// en toda la aplicación.
document.addEventListener(
  'wheel',
  () => {
    const activo = document.activeElement;
    if (activo && activo.tagName === 'INPUT' && activo.type === 'number') {
      activo.blur();
    }
  },
  { passive: true }
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
