import { lazyPreloadable } from '../../lib/lazy.jsx';

// Recharts is ~400 KB; every chart is split out and loaded on demand.
// Pages wrap these in <ChartBox> (fixed height) so nothing shifts while the
// chunk arrives.
const charts = () => import('./all.jsx');
export const AumLineChart = lazyPreloadable(charts, (m) => m.AumLineChart);
export const FlowBarChart = lazyPreloadable(charts, (m) => m.FlowBarChart);
export const PortfolioPie = lazyPreloadable(charts, (m) => m.PortfolioPie);
export const SectorPie = lazyPreloadable(charts, (m) => m.SectorPie);
export const BenchmarkBars = lazyPreloadable(charts, (m) => m.BenchmarkBars);
export const SparkBar = lazyPreloadable(charts, (m) => m.SparkBar);
export const BacktestChart = lazyPreloadable(charts, (m) => m.BacktestChart);
export const PriceChart = lazyPreloadable(charts, (m) => m.PriceChart);
// warm every wrapper (each keeps its own module reference)
export const preloadCharts = () =>
  Promise.all([AumLineChart, FlowBarChart, PortfolioPie, SectorPie, BenchmarkBars, SparkBar, BacktestChart, PriceChart].map((c) => c.preload()));
