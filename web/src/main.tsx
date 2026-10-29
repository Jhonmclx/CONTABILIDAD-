import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SessionProvider } from './lib/session';
import { ToastProvider } from './components/ui';
import { auth } from './lib/sb';
import { navigate } from './lib/router';
import './styles.css';

// Tokens que llegan por enlace de correo (confirmación o recuperación de contraseña)
const kind = auth.handleRedirect();
if (kind === 'recovery') navigate('/nueva-clave', { replace: true });
else if (kind && kind.startsWith('error:')) navigate('/ingresar?error=' + encodeURIComponent(kind.slice(6)), { replace: true });
else if (kind) navigate('/app', { replace: true });

createRoot(document.getElementById('root')!).render(
  <SessionProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </SessionProvider>,
);
