import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { api } from '../lib/api.js';
import { readGrant, saveGrant } from '../lib/leadGrant.js';
import LeadForm from '../components/LeadForm.jsx';
import { Disclaimer } from '../components/Faq.jsx';

// "Compare your portfolio with the superinvestors" — a lead magnet. The
// reader types tickers; /api/portfolio-match scores every tracked guru
// (api/_lib/portfolioMatch.js). Three matches are free; the full list opens
// with a confirmed email (the grant), which stays on the device.
const KEY = 'fc_match_tickers';
const parse = (s) => [...new Set(String(s || '').toUpperCase().split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x)))].slice(0, 25);

export default function Match() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('t') || '');
  const [grant, setGrant] = useState(null);
  const tickers = useMemo(() => parse(params.get('t')), [params]);

  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Portföyünü Usta Yatırımcılarla Karşılaştır | Fundocap' : 'Compare Your Portfolio with Superinvestors | Fundocap',
        description: lang === 'tr' ? 'Hisselerini yaz; portföyünün Warren Buffett, Bill Ackman ve 60+ usta yatırımcının 13F portföylerine ne kadar benzediğini gör.' : 'Type your tickers and see how closely your portfolio matches Warren Buffett, Bill Ackman and 60+ superinvestors’ 13F books.',
        path: '/match',
      }),
      [lang]
    )
  );

  // grant from the confirmation link, else the one kept on the device;
  // tickers from the URL, else the last ones typed here
  useEffect(() => {
    const g = params.get('g');
    if (g) saveGrant(g);
    setGrant(readGrant());
    if (!params.get('t')) {
      try {
        const saved = localStorage.getItem(KEY);
        if (saved) {
          setInput(saved);
          setParams((p) => {
            const n = new URLSearchParams(p);
            n.set('t', saved);
            n.delete('g');
            return n;
          }, { replace: true });
        }
      } catch {
        /* nothing saved */
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = useQuery({
    queryKey: ['portfolio-match', tickers.join(','), Boolean(grant)],
    queryFn: () => api.portfolioMatch(tickers, grant),
    enabled: tickers.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const submit = (e) => {
    e.preventDefault();
    const list = parse(input);
    if (!list.length) return;
    try {
      localStorage.setItem(KEY, list.join(', '));
    } catch {
      /* fine */
    }
    setParams({ t: list.join(',') });
  };

  const d = q.data;
  return (
    <div className="match-page">
      <div className="page-head">
        <div>
          <h1>🎯 {t('match.title')}</h1>
          <div className="sub">{t('match.sub')}</div>
        </div>
      </div>

      <form className="card match-form" onSubmit={submit}>
        <label className="small" htmlFor="match-input">{t('match.label')}</label>
        <div className="lead-row">
          <input id="match-input" className="lead-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="AAPL, MSFT, KO, AMZN, GOOGL" autoCapitalize="characters" />
          <button type="submit" className="btn">{t('match.cta')}</button>
        </div>
        <p className="muted small">{t('match.hint')}</p>
      </form>

      {q.isLoading && tickers.length > 0 && <div className="loading"><div className="spinner" /></div>}
      {q.error && <div className="error-box">{t('common.error')}</div>}

      {d && (
        <>
          {d.tickers.some((x) => !x.holders) && (
            <p className="muted small mt8">{t('match.unknown')}: {d.tickers.filter((x) => !x.holders).map((x) => x.ticker).join(', ')}</p>
          )}
          {!d.matches.length && <div className="card mt16">{t('match.none')}</div>}
          <div className="match-list mt16">
            {d.matches.map((m, i) => (
              <article key={m.cik} className="card match-card" data-match={m.cik}>
                <div className="match-head">
                  <span className="match-rank">#{i + 1}</span>
                  <Link to={m.path} className="match-name">{m.name}</Link>
                  <span className="match-score" title={t('match.scoreHelp')}>{m.score}<small>/100</small></span>
                </div>
                <div className="match-bar"><span style={{ width: `${Math.max(4, m.score)}%` }} /></div>
                <p className="small muted">
                  {t('match.coverage').replace('{n}', m.shared.length).replace('{m}', d.tickers.length)} · {t('match.weight').replace('{p}', m.guruWeight)}
                </p>
                <div className="match-chips">
                  {m.shared.map((s) => (
                    <Link key={s.ticker} to={`/stock/${s.ticker}`} className="chip">{s.ticker} <small>%{s.weight.toFixed(1)}</small></Link>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {!d.full && d.total > d.matches.length && (
            <LeadForm
              magnet="match"
              className="mt16"
              title={t('match.moreTitle').replace('{n}', d.total)}
              text={t('match.moreText')}
              cta={t('match.moreCta')}
            />
          )}
          <p className="muted small mt16">{t('match.method').replace('{q}', d.quarter || '')}</p>
        </>
      )}
      <Disclaimer />
    </div>
  );
}
