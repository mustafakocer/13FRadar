import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../i18n.jsx';
import Congress from '../pages/Congress.jsx';
import '../styles/tokens.css';
import '../styles/app.css';
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><I18nProvider><MemoryRouter><div style={{ padding: 16 }}><Congress /></div></MemoryRouter></I18nProvider></QueryClientProvider>);
