import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';

const EXPLORE = [
  ['/gurus', 'nav.gurus'],
  ['/filers', 'filers.title'],
  ['/consensus', 'nav.consensus'],
  ['/screen', 'nav.screen'],
  ['/insiders/cluster', 'landing.ins.tab.cluster'],
  ['/insiders/csuite', 'landing.ins.tab.csuite'],
];
const RANKINGS = [
  ['/rankings/most-bought', 'rank.mostBought'],
  ['/rankings/most-sold', 'rank.mostSold'],
  ['/rankings/consensus', 'rank.consensus'],
  ['/rankings/conviction', 'rank.conviction'],
];

export default function Footer() {
  const { t } = useI18n();
  return (
    <footer className="site-footer no-print">
      <nav aria-label="Footer">
        <div>
          <b>{t('footer.explore')}</b>
          {EXPLORE.map(([to, k]) => (
            <Link key={to} to={to}>{t(k)}</Link>
          ))}
        </div>
        <div>
          <b>{t('footer.rankings')}</b>
          {RANKINGS.map(([to, k]) => (
            <Link key={to} to={to}>{t(k)}</Link>
          ))}
        </div>
        <div>
          <b>13F Radar</b>
          <Link to="/pricing">{t('nav.pricing')}</Link>
          <Link to="/report">{t('nav.report')}</Link>
          <Link to="/compare">{t('nav.compare')}</Link>
        </div>
      </nav>
      <div className="footer-brand">
        📡 13F<span className="dot">Radar</span>
      </div>
      <p className="muted small">{t('footer.disclaimer')}</p>
      <p className="muted small">{t('footer.sources')}</p>
      <p className="muted small">© {new Date().getFullYear()} 13F Radar</p>
    </footer>
  );
}
