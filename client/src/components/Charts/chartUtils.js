// Recharts sets SVG fill/stroke as attributes, which don't resolve CSS vars —
// read the computed token values instead. App re-renders on theme toggle, so
// calling this during render keeps charts in sync with the theme.
export const getVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

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
