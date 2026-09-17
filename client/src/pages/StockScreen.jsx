import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { useGuruStocks } from '../hooks/useGuruStocks.js';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import { fmtMoney, fmtNum, fmtPct, deltaClass } from '../lib/format.js';
import { managerPath } from '../lib/paths.js';
import FilterSelect from '../components/FilterSelect.jsx';
import AnswerBox from '../components/AnswerBox.jsx';
import { Disclaimer } from '../components/Faq.jsx';
import Ico from '../components/Ico.jsx';
import { Search } from 'lucide-react';

const CAPS = ['mega', 'large', 'mid', 'small', 'micro'];
const MIN_HOLDERS = ['2', '3', '5', '10'];

// The screener from the other direction: not "which funds look like this" but
// "which stocks does this many of them own". Every filter runs on the server,
// over the whole table, so narrowing never silently searches only the page
// that happens to be loaded.
export default function StockScreen() {
  const { t, lang } = useI18n();
  const [sector, setSector] = useState('');
  const [cap, setCap] = useState('');
  const [minHolders, setMinHolders] = useState('');
  const [strongBuy, setStrongBuy] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'rank', dir: 1 });

  const table = useGuruStocks({ limit: 500, sector, cap, minHolders, strongBuy });
  const returns = useStaticReturns();

  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const out = table.stocks.filter(
      (r) =>
        !needle ||
        String(r.ticker || '').includes(needle) ||
        String(r.issuer || '').toUpperCase().includes(needle)
    );
    const { key, dir } = sort;
    return [...out].sort((a, b) => {
      const av = a[key] ?? -Infinity;
      const bv = b[key] ?? -Infinity;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [table.stocks, q, sort]);

  const answer = useMemo(() => {
    if (!table.ready || !rows.length) return null;
    const top = rows[0];
    return lang === 'tr'
      ? `Takip edilen ${fmtNum(table.managers)} usta yatırımcının elindeki ${fmtNum(table.universe)} menkul, tutan fon sayısına göre sıralanır; sektör, piyasa değeri ve çeyrek aktivitesine göre filtrelenebilir. Şu anki ilk sıra: ${top.ticker || top.issuer} (${fmtNum(top.holderCount)} fon).`
      : `The ${fmtNum(table.universe)} securities held by the ${fmtNum(table.managers)} tracked superinvestors, ranked by how many of them own each one and filterable by sector, market cap and what the quarter did. Currently first: ${top.ticker || top.issuer} (${fmtNum(top.holderCount)} funds).`;
  }, [table.ready, table.universe, table.managers, rows, lang]);

  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Hisse Tarayıcı: Usta Sahipliğine Göre Filtrele | Fundocap' : 'Stock Screener: Filter by Guru Ownership | Fundocap',
        description:
          lang === 'tr'
            ? 'Usta yatırımcıların tuttuğu hisseleri fon sayısı, portföy ağırlığı, sektör ve piyasa değerine göre tarayın.'
            : 'Screen the stocks superinvestors hold by how many funds own them, portfolio weight, sector and market cap.',
        answer,
        path: '/screen/stocks',
      }),
      [lang, answer]
    )
  );

  const OPT = (values, prefix) => [
    { v: '', label: t('screen.all') },
    ...values.map((v) => ({ v, label: prefix ? t(`${prefix}.${v}`) : v })),
  ];
  const onSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'rank' ? 1 : -1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir === -1 ? ' ↓' : ' ↑') : '');

  return (
    <div>
      <div className="page-head">
        <div>
          <h1><Ico icon={Search} size={22} /> {t('stockscreen.title')}</h1>
          <div className="sub">{t('stockscreen.sub')}</div>
        </div>
      </div>
      <AnswerBox text={answer} />

      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        <Link to="/screen" className="chip">{t('screen.funds')}</Link>
        <Link to="/screen/stocks" className="chip fsel-active">{t('screen.stocks')}</Link>
      </div>

      <div className="card ins-toolbar">
        <input
          className="search-input sm"
          placeholder={t('filings.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {table.sectors.length > 0 && (
            <FilterSelect label={t('screen.sector')} value={sector} onChange={setSector} options={OPT(table.sectors)} />
          )}
          <FilterSelect label={t('screen.size')} value={cap} onChange={setCap} options={OPT(CAPS, 'size')} />
          <FilterSelect
            label={t('stockscreen.minHolders')}
            value={minHolders}
            onChange={setMinHolders}
            options={[{ v: '', label: t('screen.all') }, ...MIN_HOLDERS.map((v) => ({ v, label: `${v}+` }))]}
          />
          <button className={`chip${strongBuy ? ' fsel-active' : ''}`} onClick={() => setStrongBuy(!strongBuy)}>
            {t('rank.strongBuy')}
          </button>
          <span className="small muted" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            {fmtNum(rows.length)} / {fmtNum(table.universe)}
          </span>
          {(sector || cap || minHolders || strongBuy || q) && (
            <button
              className="btn ghost sm"
              onClick={() => {
                setSector('');
                setCap('');
                setMinHolders('');
                setStrongBuy(false);
                setQ('');
              }}
            >
              {t('screen.reset')}
            </button>
          )}
        </div>
      </div>

      {table.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {!table.isLoading && !table.ready && <div className="card mt16 muted">{t('stockscreen.building')}</div>}

      {table.ready && (
        <div className="card mt16">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l" onClick={() => onSort('rank')}>{t('table.rank')}{arrow('rank')}</th>
                  <th className="l">{t('table.symbol')}</th>
                  <th className="l">{t('table.company')}</th>
                  <th className="l">{t('screen.sector')}</th>
                  <th onClick={() => onSort('holderCount')}>{t('stockscreen.holders')}{arrow('holderCount')}</th>
                  <th onClick={() => onSort('totalValue')}>{t('consensus.totalValue')}{arrow('totalValue')}</th>
                  <th onClick={() => onSort('maxWeight')}>{t('stockscreen.topWeight')}{arrow('maxWeight')}</th>
                  <th onClick={() => onSort('netValue')}>{t('stockscreen.net')}{arrow('netValue')}</th>
                  <th>{t('landing.act.ytd')}</th>
                  <th className="l">{t('consensus.heldBy')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ret = r.ticker ? (returns.data?.[r.ticker]?.retYtd ?? null) : null;
                  return (
                    <tr key={r.cusip}>
                      <td className="l muted">{r.rank}</td>
                      <td className="l">
                        {r.ticker ? (
                          <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }}>{r.ticker}</Link>
                        ) : (
                          <span className="muted small">{r.cusip}</span>
                        )}
                      </td>
                      <td className="l">{r.issuer}</td>
                      <td className="l small muted">{r.sector || '—'}</td>
                      <td className="num">{fmtNum(r.holderCount)}</td>
                      <td className="num">{fmtMoney(r.totalValue)}</td>
                      <td className="num">{fmtPct(r.maxWeight, { sign: false })}</td>
                      <td className={`num ${r.netValue >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                        {r.netValue >= 0 ? '+' : '−'}{fmtMoney(Math.abs(r.netValue))}
                      </td>
                      <td className={`num ${deltaClass(ret)}`}>{ret != null ? fmtPct(ret) : '—'}</td>
                      <td className="l small">
                        {(r.holders || []).map((h, j) => (
                          <span key={h.cik}>{j > 0 && ', '}<Link to={managerPath(h.cik)}>{h.name}</Link></span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Disclaimer />
        </div>
      )}
    </div>
  );
}
