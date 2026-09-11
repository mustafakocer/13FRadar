import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { I18nProvider } from './i18n.jsx';
import { AuthProvider } from './auth.jsx';
import { SeoProvider } from './seo.jsx';

// Provider stack shared by the client entry (main.jsx) and the server entry
// (entry-server.jsx). The router is injected by the entry because the
// browser and the server use different router implementations.
export default function Root({ queryClient, lang, seo = null, router: Router, routerProps = {} }) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider lang={lang}>
        <SeoProvider collector={seo}>
          <AuthProvider>
            <Router basename={`/${lang}`} {...routerProps}>
              <App />
            </Router>
          </AuthProvider>
        </SeoProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

export const queryDefaults = {
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
};
