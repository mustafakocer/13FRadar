import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format.js';
import { POPULAR_MANAGERS } from '../data/popular.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import Paywall from '../components/Paywall.jsx';
import FilterSelect from '../components/FilterSelect.jsx';
import { useSeo } from '../seo.jsx';
import { managerPath } from '../lib/paths.js';

const GURU_CIKS = new Set(POPULAR_MANAGERS.map((m) => m.cik));

// Category from the filer's legal name — the US equivalent of fund types.
function categorize(name) {
  const n = name.toUpperCase();
  if (/\bBANK|BANCORP|BANC\b|BANCSHARES|SPARKASSE|NATIONAL ASSN/.test(n)) return 'bank';
  if (/INSURANCE|ASSURANCE|LIFE INS|MUTUAL LIFE|REINSURANCE/.test(n)) return 'insurance';
  if (/PENSION|RETIREMENT|EMPLOYEES|TEACHERS|PUBLIC SCHOOL/.test(n)) return 'pension';
  if (/UNIVERSITY|COLLEGE|ENDOWMENT|FOUNDATION|CHARITABLE/.test(n)) return 'endowment';
  if (/FAMILY OFFICE|FAMILY WEALTH|FAMILY/.test(n)) return 'family';
  return 'advisor';
}

const SIZE = {
  mega: (a) => a >= 50e9,
  large: (a) => a >= 10e9 && a < 50e9,
  mid: (a) => a >= 1e9 && a < 10e9,
  small: (a) => a >= 100e6 && a < 1e9,
  micro: (a) => a < 100e6,
};
const POS = {
  focused: (p) => p <= 20,
  p2150: (p) => p >= 21 && p <= 50,
  p51200: (p) => p >= 51 && p <= 200,
  p200: (p) => p > 200,
};
const CONC = {
  c75: (c) => c > 75,
  c5075: (c) => c >= 50 && c <= 75,
  c2550: (c) => c >= 25 && c < 50,
  c25: (c) => c < 25,
};

const ADV_EMPTY = { minAum: '', maxAum: '', minPos: '', maxPos: '', minTop10: '', maxTop10: '' };

export default function Screen() {
  const { t, lang } = useI18n();
  const { isPro } = useAuth();
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Fon Tarayıcı: 8.000+ 13F Dosyalayan Kurumu Filtreleyin | 13F Radar' : 'Fund Screener: Filter 8,000+ 13F Filers | 13F Radar',
        description: lang === 'tr' ? 'Tüm 13F evrenini AUM, pozisyon sayısı ve yoğunlaşmaya göre filtreleyin; odaklı fonları keşfedin.' : 'Filter the entire 13F universe by AUM, position count and concentration; discover focused funds.',
        path: '/screen',
      }),
      [lang, t]
    )
  );

  const [q, setQ] = useState('');
  const [size, setSize] = useState('');
  const [pos, setPos] = useState('');
  const [conc, setConc] = useState('');
  const [cat, setCat] = useState('');
  const [advOpen, setAdvOpen] = useState(false);
  const [adv, setAdv] = useState(ADV_EMPTY);
  const [draft, setDraft] = useState(ADV_EMPTY);
  const [sort, setSort] = useState({ key: 'aum', dir: -1 });
  const [shown, setShown] = useState(100);
  const [exporting, setExporting] = useState(false);

  const universe = useQuery({
    queryKey: ['universe'],
    queryFn: api.universe,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });

  const rows = useMemo(() => {
    const all = universe.data?.rows || [];
    const ql = q.trim().toLowerCase();
    let out = all.filter((r) => {
      if (ql && !r.name.toLowerCase().includes(ql)) return false;
      if (size && !SIZE[size](r.aum)) return false;
      if (pos && !POS[pos](r.positions)) return false;
      if (conc && !CONC[conc](r.top10)) return false;
      if (cat === 'gurus') {
        if (!GURU_CIKS.has(r.cik)) return false;
      } else if (cat && categorize(r.name) !== cat) return false;
      if (adv.minAum && r.aum / 1e6 < Number(adv.minAum)) return false;
      if (adv.maxAum && r.aum / 1e6 > Number(adv.maxAum)) return false;
      if (adv.minPos && r.positions < Number(adv.minPos)) return false;
      if (adv.maxPos && r.positions > Number(adv.maxPos)) return false;
      if (adv.minTop10 && r.top10 < Number(adv.minTop10)) return false;
      if (adv.maxTop10 && r.top10 > Number(adv.maxTop10)) return false;
      return true;
    });
    const { key, dir } = sort;
    out.sort((a, b) => {
      const av = key === 'name' ? a.name : a[key];
      const bv = key === 'name' ? b.name : b[key];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
    return out;
  }, [universe.data, q, size, pos, conc, cat, adv, sort]);

  const advCount = Object.values(adv).filter(Boolean).length;
  const onSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir === -1 ? ' ↓' : ' ↑') : '');

  const onExport = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const data = rows.map((r, i) => ({
        '#': i + 1,
        [t('screen.manager')]: r.name,
        CIK: r.cik.replace(/^0+/, ''),
        [t('screen.category')]: t(`cat.${categorize(r.name)}`),
        'AUM ($)': r.aum,
        [t('manager.positions')]: r.positions,
        'Top-10 %': r.top10,
        [t('manager.filedOn')]: r.filed,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Funds');
      XLSX.writeFile(wb, '13f_funds.xlsx');
    } finally {
      setExporting(false);
    }
  };

  const OPT = (arr) => [{ v: '', label: t('screen.all') }, ...arr];

  if (universe.isError) {
    return (
      <div>
        <div className="page-head">
          <h1>{t('screen.title')}</h1>
        </div>
        <div className="card muted">{t('screen.noUniverse')}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('screen.title')}</h1>
          <div className="sub">
            {universe.data
              ? `${fmtNum(universe.data.count)} ${t('screen.subtitle2')} · ${universe.data.updatedAt?.slice(0, 10)}`
              : t('screen.subtitle')}
          </div>
        </div>
      </div>

      {/* Fintables-style toolbar — filtering is a Pro feature */}
      <div
        className="row"
        style={{ gap: 8, ...(isPro ? {} : { opacity: 0.5, pointerEvents: 'none', filter: 'grayscale(0.6)' }) }}
      >
        <input
          className="search-input sm"
          style={{ maxWidth: 220 }}
          placeholder={t('screen.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <FilterSelect
          label={t('screen.size')}
          value={size}
          onChange={setSize}
          options={OPT([
            { v: 'mega', label: t('size.mega') },
            { v: 'large', label: t('size.large') },
            { v: 'mid', label: t('size.mid') },
            { v: 'small', label: t('size.small') },
            { v: 'micro', label: t('size.micro') },
          ])}
        />
        <FilterSelect
          label={t('screen.positions')}
          value={pos}
          onChange={setPos}
          options={OPT([
            { v: 'focused', label: t('pos.focused') },
            { v: 'p2150', label: t('pos.p2150') },
            { v: 'p51200', label: t('pos.p51200') },
            { v: 'p200', label: t('pos.p200') },
          ])}
        />
        <FilterSelect
          label={t('screen.conc')}
          value={conc}
          onChange={setConc}
          options={OPT([
            { v: 'c75', label: t('conc.c75') },
            { v: 'c5075', label: t('conc.c5075') },
            { v: 'c2550', label: t('conc.c2550') },
            { v: 'c25', label: t('conc.c25') },
          ])}
        />
        <FilterSelect
          label={t('screen.category')}
          value={cat}
          onChange={setCat}
          options={OPT([
            { v: 'gurus', label: t('cat.gurus') },
            { v: 'advisor', label: t('cat.advisor') },
            { v: 'bank', label: t('cat.bank') },
            { v: 'insurance', label: t('cat.insurance') },
            { v: 'pension', label: t('cat.pension') },
            { v: 'endowment', label: t('cat.endowment') },
            { v: 'family', label: t('cat.family') },
          ])}
        />
        <button
          className={`chip${advCount ? ' fsel-active' : ''}`}
          onClick={() => {
            setDraft(adv);
            setAdvOpen((o) => !o);
          }}
        >
          ⚙️ {t('screen.advanced')}
          {advCount > 0 && ` (${advCount})`}
        </button>
        {isPro && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={onExport} disabled={exporting || !rows.length}>
            {exporting ? '…' : `⬇ ${t('table.export')}`}
          </button>
        )}
      </div>

      {!isPro && (
        <div className="mt8">
          <Paywall compact />
        </div>
      )}

      {isPro && advOpen && (
        <div className="adv-panel">
          <div className="adv-grid">
            {[
              ['minAum', 'screen.minAum'],
              ['maxAum', 'screen.maxAumM'],
              ['minPos', 'screen.minPos'],
              ['maxPos', 'screen.maxPositions'],
              ['minTop10', 'screen.minTop10'],
              ['maxTop10', 'screen.maxTop10'],
            ].map(([k, label]) => (
              <label key={k}>
                {t(label)}
                <input
                  className="search-input sm"
                  type="number"
                  value={draft[k]}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="row mt16">
            <button
              className="btn"
              onClick={() => {
                setAdv(draft);
                setAdvOpen(false);
              }}
            >
              {t('screen.apply')}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setDraft(ADV_EMPTY);
                setAdv(ADV_EMPTY);
              }}
            >
              {t('screen.clear')}
            </button>
          </div>
        </div>
      )}

      <div className="card mt16">
        {universe.isLoading && (
          <div className="loading">
            <div className="spinner" />
            {t('common.loading')}
          </div>
        )}
        {universe.data && (
          <>
            <div className="muted small" style={{ marginBottom: 8 }}>
              {fmtNum(rows.length)} {t('screen.results')}
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="l">#</th>
                    <th className="l sortable" onClick={() => onSort('name')}>
                      {t('screen.manager')}{arrow('name')}
                    </th>
                    <th className="l">{t('screen.category')}</th>
                    <th className="sortable" onClick={() => onSort('aum')}>
                      {t('screen.aum')}{arrow('aum')}
                    </th>
                    <th className="sortable" onClick={() => onSort('positions')}>
                      {t('manager.positions')}{arrow('positions')}
                    </th>
                    <th className="sortable" onClick={() => onSort('top10')}>
                      {t('manager.top10')}{arrow('top10')}
                    </th>
                    <th className="sortable" onClick={() => onSort('filed')}>
                      {t('manager.filedOn')}{arrow('filed')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, isPro ? shown : 50).map((r, i) => (
                    <tr key={r.cik}>
                      <td className="l muted">{i + 1}</td>
                      <td className="l">
                        <Link to={managerPath(r.cik)} style={{ fontWeight: 700 }}>
                          {r.name}
                        </Link>
                        {GURU_CIKS.has(r.cik) && ' ⭐'}
                      </td>
                      <td className="l">
                        <span className="badge plain" style={{ fontSize: 11 }}>
                          {t(`cat.${categorize(r.name)}`)}
                        </span>
                      </td>
                      <td className="num">{fmtMoney(r.aum)}</td>
                      <td className="num">{fmtNum(r.positions)}</td>
                      <td className="num">{fmtPct(r.top10, { sign: false })}</td>
                      <td className="num muted">{r.filed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isPro && rows.length > 50 && (
              <div className="mt16">
                <Paywall compact />
              </div>
            )}
            {isPro && rows.length > shown && (
              <button className="btn ghost mt16" onClick={() => setShown((s) => s + 200)}>
                {t('common.all')} ({fmtNum(rows.length)})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
