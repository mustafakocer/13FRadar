// The consent-gated tags together: Meta Pixel (lib/metaPixel.js), Google
// Analytics 4 (lib/ga.js) and Microsoft Clarity (lib/clarity.js). The cookie
// banner appears when at least one of them is configured in the build.
import { pixelConfigured, pageView as pixelPageView } from './metaPixel.js';
import { gaConfigured, gaPageView } from './ga.js';
import { clarityConfigured, loadClarity } from './clarity.js';

export const tagsConfigured = () => pixelConfigured() || gaConfigured() || clarityConfigured();

// one call per route change once consent is granted (each is a no-op otherwise)
export function routeChanged() {
  pixelPageView();
  gaPageView();
  loadClarity(); // Clarity follows SPA navigation itself after it loads
}
