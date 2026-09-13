import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import Ico from './Ico.jsx';
import { Radar } from 'lucide-react';

const EXPLORE = [
  ['/gurus', 'nav.gurus'],
  ['/filers', 'filers.title'],
  ['/consensus', 'nav.consensus'],
  ['/screen', 'nav.screen'],
  ['/insiders/cluster', 'landing.ins.tab.cluster'],
  ['/insiders/csuite', 'landing.ins.tab.csuite'],
  ['/insiders/penny', 'landing.ins.tab.penny'],
];
const LEARN = [
  ['/guides/what-is-13f', '/rehber/13f-nedir', 'guide.what'],
  ['/guides/how-to-read-form-4', '/rehber/form-4-nasil-okunur', 'guide.form4'],
  ['/guides/13f-limitations', '/rehber/13f-sinirlari', 'guide.limits'],
  ['/guides/best-13f-trackers', '/rehber/en-iyi-13f-takip-araclari', 'guide.best'],
];
const RANKINGS = [
  ['/rankings/most-bought', 'rank.mostBought'],
  ['/rankings/most-sold', 'rank.mostSold'],
  ['/rankings/consensus', 'rank.consensus'],
  ['/rankings/conviction', 'rank.conviction'],
];

export default function Footer() {
  const { t, lang } = useI18n();
  return (
    <footer className="site-footer no-print">
      <nav aria-label="Footer">
        <div>
          <b>{t('footer.learn')}</b>
          {LEARN.map(([en, tr, k]) => (
            <Link key={k} to={lang === 'tr' ? tr : en}>{t(k)}</Link>
          ))}
          <Link to="/calendar">{t('cal.title')}</Link>
          <Link to="/reports">{t('rep.indexSub')}</Link>
        </div>
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
        <Ico icon={Radar} size={18} /> 13F<span className="dot">Radar</span>
      </div>
      <p className="muted small">{t('footer.disclaimer')}</p>
      <p className="muted small">{t('footer.sources')}</p>
      <p className="muted small">© {new Date().getFullYear()} 13F Radar</p>
    </footer>
  );
}
