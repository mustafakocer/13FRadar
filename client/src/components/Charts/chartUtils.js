// Chart colours come straight from the token layer: SVG presentation
// attributes (fill/stroke) resolve var() like any CSS value, so the charts
// follow the theme without a colour table on the JS side (and the server
// render matches the client byte for byte).
export const getVar = (name) => `var(${name})`;

// the categorical ramp, in order — never mixed with the heatmap ramp
export const seriesColors = () =>
  ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'].map(getVar);

export const tooltipStyle = () => ({
  background: getVar('--popover'),
  border: `1px solid ${getVar('--border')}`,
  borderRadius: 10,
  fontSize: 13,
  fontFamily: 'inherit',
  color: getVar('--text'),
});
