import { useI18n } from '../i18n.jsx';
import { fmtMoney, fmtNum } from '../lib/format.js';
import { pulsePercents, pulseDate } from '../lib/insiderPulse.js';

// The newest filing day's open-market buys and sells — the same block on the
// home page ("Piyasa Nabzı", insiders-teaser.json `pulse`) and on /insiders
// (/api/insider-feed `stats`). Both objects come from one function
// (api/_lib/insiderModel.js daySummary); this renders them one way, so the
// two pages show the same counts, amounts, percentages and date.
export default function InsiderDaySummary({ summary, big = false }) {
  const { t, lang } = useI18n();
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  if (!summary) return null;
  const pct = pulsePercents(summary);
  return (
    <div className="ins-day" data-day={summary.day || ''}>
      <div className="muted small" data-pulse-date>
        {t('ins.dayOf')} {pulseDate(summary.day, locale)}
      </div>
      <div className={`ins-bar${big ? ' big' : ''}`}>
        <span className="buy" style={{ width: `${pct.buy ?? 50}%` }} />
        <span className="sell" style={{ width: `${pct.sell ?? 50}%` }} />
      </div>
      <div className="row ins-bar-legend">
        <span className="delta-pos" data-buy-pct={pct.buy ?? ''}>
          {t('ins.purchases')} {pct.buy != null ? `${pct.buy}%` : '—'} · {fmtMoney(summary.buyValue)}
        </span>
        <span className="delta-neg" style={{ marginLeft: 'auto' }} data-sell-pct={pct.sell ?? ''}>
          {t('ins.sells')} {pct.sell != null ? `${pct.sell}%` : '—'} · {fmtMoney(summary.sellValue)}
        </span>
      </div>
      <div className="ins-counts">
        <div className="pos"><b data-buy-count>{fmtNum(summary.buyCount)}</b><span>{t('ins.purchases')}</span></div>
        <div className="neg"><b data-sell-count>{fmtNum(summary.sellCount)}</b><span>{t('ins.sells')}</span></div>
      </div>
      {summary.fxExcluded > 0 && <div className="muted small" data-fx-excluded={summary.fxExcluded}>{t('ins.fxExcluded').replace('{n}', summary.fxExcluded)}</div>}
      {summary.offMarket > 0 && <div className="muted small" data-off-market-count={summary.offMarket}>{t('ins.offMarketExcluded').replace('{n}', summary.offMarket)}</div>}
    </div>
  );
}
