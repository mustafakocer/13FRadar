import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtNum } from '../lib/format.js';
import { managerPath } from '../lib/paths.js';
import FilterSelect from '../components/FilterSelect.jsx';
import AnswerBox from '../components/AnswerBox.jsx';
import { Disclaimer } from '../components/Faq.jsx';
import Ico from '../components/Ico.jsx';
import { Inbox } from 'lucide-react';

const HOUR = 60 * 60 * 1000;
const PER_PAGE = [20, 50, 100];

// Every 13F as it lands, newest first. The quarter a filing reports on is not
// the quarter it was filed in — an amendment restates an old period months
// later — so the two dates are separate columns and the filter uses the
// period, which is the question a reader actually has.
export default function Filings() {
  const { t, lang } = useI18n();
  const [quarter, setQuarter] = useState('');
  const [form, setForm] = useState('');
  const [q, setQ] = useState('');
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['filings'],
    queryFn: async () => {
      const r = await fetch('/filings.json');
      if (!r.ok) throw new Error('no-filings');
      return r.json();
    },
    staleTime: HOUR,
    retry: 1,
  });

  const all = data?.rows || [];
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return all.filter((r) => {
      if (form === 'amended' && !r.amended) return false;
      if (form === 'original' && r.amended) return false;
      if (quarter && quarterOf(r.reportDate) !== quarter) return false;
      if (needle && !String(r.name || '').toUpperCase().includes(needle)) return false;
      return true;
    });
  }, [all, form, quarter, q]);

  const shown = rows.slice((page - 1) * perPage, page * perPage);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const newest = all[0]?.filed || null;

  const answer = useMemo(() => {
    if (!all.length) return null;
    const amendments = all.filter((r) => r.amended).length;
    return lang === 'tr'
      ? `Son ${fmtNum(all.length)} adet 13F bildirimi ${newest} tarihine kadar listelenir; ${fmtNum(amendments)} tanesi düzeltme (13F-HR/A). Her satır bildirilen dönemi, dosyalama tarihini ve — ölçülebildiğinde — portföy büyüklüğü ile pozisyon sayısını gösterir.`
      : `The ${fmtNum(all.length)} most recent 13F filings through ${newest}, ${fmtNum(amendments)} of them amendments (13F-HR/A). Each row carries the period reported, the date filed and — where it has been measured — portfolio value and position count.`;
  }, [all, newest, lang]);

  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Son 13F Bildirimleri | Fundocap' : 'Latest 13F Filings | Fundocap',
        description:
          lang === 'tr'
            ? 'SEC EDGAR’a ulaşan 13F-HR ve 13F-HR/A bildirimleri; dönem, dosyalama tarihi, portföy büyüklüğü ve pozisyon sayısı.'
            : '13F-HR and 13F-HR/A reports as they reach SEC EDGAR, with period, filing date, portfolio value and position count.',
        answer,
        path: '/filings',
        dateModified: (data?.updatedAt || '').slice(0, 10) || null,
      }),
      [lang, answer, data]
    )
  );

  const quarters = data?.quarters || [];
  const reset = () => {
    setQuarter('');
    setForm('');
    setQ('');
    setPage(1);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1><Ico icon={Inbox} size={22} /> {t('filings.title')}</h1>
          <div className="sub">{t('filings.sub')}{newest ? ` · ${newest}` : ''}</div>
        </div>
      </div>
      <AnswerBox text={answer} />

      <div className="card ins-toolbar">
        <input
          className="search-input sm"
          placeholder={t('filings.search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <FilterSelect
            label={t('filings.quarter')}
            value={quarter}
            onChange={(v) => {
              setQuarter(v);
              setPage(1);
            }}
            options={[
              { v: '', label: t('screen.all') },
              ...quarters.map((x) => ({ v: x.quarter, label: `${x.quarter} (${fmtNum(x.count)})` })),
            ]}
          />
          <FilterSelect
            label={t('filings.form')}
            value={form}
            onChange={(v) => {
              setForm(v);
              setPage(1);
            }}
            options={[
              { v: '', label: t('screen.all') },
              { v: 'original', label: '13F-HR' },
              { v: 'amended', label: '13F-HR/A' },
            ]}
          />
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {fmtNum(rows.length)} {t('filings.results')}
          </span>
          {(quarter || form || q) && (
            <button className="btn ghost sm" onClick={reset}>{t('screen.reset')}</button>
          )}
        </div>
      </div>

      {isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {!isLoading && !all.length && <div className="card mt16 muted">{t('filings.building')}</div>}

      {all.length > 0 && (
        <div className="card mt16">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('filings.filer')}</th>
                  <th className="l">{t('filings.reportFor')}</th>
                  <th className="l">{t('filings.filedAt')}</th>
                  <th>{t('filings.aum')}</th>
                  <th>{t('filings.holdings')}</th>
                  <th className="l">{t('filings.form')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.acc}>
                    <td className="l">
                      <Link to={managerPath(r.cik)}>{r.name}</Link>
                      {r.state && <span className="badge plain sm" style={{ marginLeft: 6 }}>{r.state}</span>}
                    </td>
                    <td className="l">{quarterOf(r.reportDate) || <span className="muted">—</span>}</td>
                    <td className="l">{r.filed}</td>
                    {/* figures are the document's own: the universe scan's
                        measurement of an original, or an amendment's table —
                        a restatement's whole book, or the lines a NEW
                        HOLDINGS amendment adds (shown with a plus) */}
                    <td className="num">{r.aum != null ? `${r.amendmentType === 'NEW HOLDINGS' ? '+' : ''}${fmtMoney(r.aum)}` : <span className="muted">—</span>}</td>
                    <td className="num">{r.positions != null ? `${r.amendmentType === 'NEW HOLDINGS' ? '+' : ''}${fmtNum(r.positions)}` : <span className="muted">—</span>}</td>
                    <td className="l">
                      <span className={`badge sm ${r.amended ? 'neg' : 'plain'}`}>{r.form}</span>
                      {r.amendmentType && (
                        <span className="small muted" style={{ marginLeft: 6 }}>
                          {t(r.amendmentType === 'RESTATEMENT' ? 'filings.amend.restatement' : 'filings.amend.newHoldings')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row mt16" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="small muted">{t('filings.show')}</span>
            {PER_PAGE.map((n) => (
              <button
                key={n}
                className={`chip sm${perPage === n ? ' fsel-active' : ''}`}
                onClick={() => {
                  setPerPage(n);
                  setPage(1);
                }}
              >
                {n}
              </button>
            ))}
            <span style={{ marginLeft: 'auto' }} className="row">
              <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('common.prev')}
              </button>
              <span className="small muted" style={{ padding: '0 8px' }}>
                {page} / {pages}
              </span>
              <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                {t('common.next')}
              </button>
            </span>
          </div>
          <Disclaimer />
        </div>
      )}
    </div>
  );
}

function quarterOf(reportDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reportDate || ''))) return null;
  return `Q${Math.floor((Number(reportDate.slice(5, 7)) - 1) / 3) + 1} ${reportDate.slice(0, 4)}`;
}
