// Recharts sets SVG fill/stroke as attributes, which don't resolve CSS vars —
// read the computed token values instead. App re-renders on theme toggle, so
// calling this during render keeps charts in sync with the theme.
const SSR_FALLBACK = { '--surface': '#ffffff', '--border': '#e8e0d2', '--ink': '#101a2e', '--s1': '#2a78d6', '--s2': '#1baf7a', '--s3': '#eda100', '--s4': '#008300', '--s5': '#4a3aa7', '--s6': '#e34948', '--s7': '#e87ba4', '--s8': '#eb6834', '--muted': '#5d6675', '--grid': '#ece5d8', '--pos': '#0a7a52', '--neg': '#c93a38', '--accent': '#ffd250' };
export const getVar = (name) =>
  typeof window === 'undefined'
    ? SSR_FALLBACK[name] || '#888888'
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const seriesColors = () =>
  ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'].map(getVar);

export const tooltipStyle = () => ({
  background: getVar('--surface'),
  border: `1px solid ${getVar('--border')}`,
  borderRadius: 10,
  fontSize: 13,
  fontFamily: 'inherit',
  color: getVar('--ink'),
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
});
