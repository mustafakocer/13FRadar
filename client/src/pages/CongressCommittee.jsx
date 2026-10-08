import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtNum } from '../lib/format.js';
import { breadcrumbs } from '../lib/seoTemplates.js';
import { itemList, webPage } from '../lib/jsonld.js';
import AnswerBox from '../components/AnswerBox.jsx';
import Ico from '../components/Ico.jsx';
import CongressTable, { CongressDisclaimer, MemberBoard, TickerBoard } from '../components/CongressTable.jsx';

const HOUR = 60 * 60 * 1000;
const CHAMBER = { H: 'cg.house', S: 'cg.senate', J: 'cg.joint' };

// /congress/committee/:slug — the members of one committee and what they trade.
export default function CongressCommittee() {
  const { slug } = useParams();
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ['congress-committee', slug], queryFn: () => api.congressCommittee(slug), staleTime: HOUR, retry: false });
  const d = q.data;
  const c = d?.committee;
  const active = d?.members?.filter((m) => m.trades > 0) || [];
  const answer = c
    ? (lang === 'tr'
        ? '{name}: {active} üyesinin hisse işlemi kayıtlı; toplam {trades} işlem ({buys} alım, {sells} satış), tahmini ~{vol}. En çok işlem yapan üye: {top}. Üyelerin en çok aldığı hisse: {stock}.'
        : '{name}: {active} of its members have disclosed stock trades — {trades} in total ({buys} buys, {sells} sells), an estimated ~{vol}. Most active member: {top}. Bought by the most members: {stock}.')
        .replace('{name}', c.name)
        .replace('{active}', fmtNum(active.length))
        .replace('{trades}', fmtNum(c.trades))
        .replace('{buys}', fmtNum(c.buys))
        .replace('{sells}', fmtNum(c.sells))
        .replace('{vol}', fmtMoney(c.volume))
        .replace('{top}', active[0] ? `${active[0].n} (${fmtNum(active[0].trades)})` : '—')
        .replace('{stock}', d.topBought?.[0]?.t || '—')
    : null;
  useSeo(
    useMemo(
      () => ({
        title: c ? (lang === 'tr' ? `${c.name}: Üyelerin Hisse İşlemleri | Fundocap` : `${c.name}: Members' Stock Trades | Fundocap`) : 'Fundocap',
        description: answer ? answer.slice(0, 155) : undefined,
        answer,
        path: `/congress/committee/${slug}`,
        dateModified: d?.updatedAt?.slice(0, 10) || null,
        noindex: q.isError,
        jsonLd: c
          ? [
              webPage({ name: lang === 'tr' ? `${c.name} hisse işlemleri` : `${c.name} stock trades`, description: answer, lang, path: `/congress/committee/${slug}`, dateModified: d.updatedAt }),
              itemList({ name: lang === 'tr' ? `${c.name} üyeleri` : `${c.name} members`, lang, items: active.slice(0, 30).map((m) => ({ name: m.n, path: `/congress/${m.slug}` })) }),
              breadcrumbs(lang, [
                [lang === 'tr' ? 'Kongre İşlemleri' : 'Congress Trades', '/congress'],
                [c.name, `/congress/committee/${slug}`],
              ]),
            ]
          : [],
      }),
      [lang, d, c, answer, slug, q.isError, active]
    )
  );
  if (q.isLoading) return <div className="loading"><div className="spinner" />{t('common.loading')}</div>;
  if (!c) return <div className="error-box">{t('cg.committeeMissing')} <Link to="/congress">{t('cg.backToAll')}</Link></div>;
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="muted small"><Link to="/congress">{t('cg.title')}</Link> › {t('cg.tab.committees')}</div>
          <h1><Ico icon={Gavel} size={22} /> {c.name}</h1>
          <div className="sub">{t(CHAMBER[c.ch])} · {t('cg.committeeSub')}</div>
        </div>
      </div>
      <AnswerBox text={answer} />

      <div className="fund-stats mt16">
        <div className="fund-stat">
          <span className="k">{t('cg.members')}</span>
          <b>{fmtNum(active.length)}</b>
          <span className="s">{t('cg.committeeTrading')}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.trades')}</span>
          <b>{fmtNum(c.trades)}</b>
          <span className="s"><span className="text-buy">{fmtNum(c.buys)} {t('cg.buys').toLowerCase()}</span> · <span className="text-sell">{fmtNum(c.sells)} {t('cg.sells').toLowerCase()}</span></span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.volume')}</span>
          <b>~{fmtMoney(c.volume)}</b>
          <span className="s">{t('cg.volumeTip')}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.lastFiled')}</span>
          <b>{c.last || '—'}</b>
        </div>
      </div>

      <div className="card mt16">
        <h3>{t('cg.committeeMembers')}</h3>
        <MemberBoard rows={active} />
      </div>

      <div className="grid grid-2 mt16">
        <div className="card">
          <h3>{t('cg.tab.bought')}</h3>
          <TickerBoard rows={d.topBought?.slice(0, 10)} />
        </div>
        <div className="card">
          <h3>{t('cg.tab.sold')}</h3>
          <TickerBoard rows={d.topSold?.slice(0, 10)} />
        </div>
      </div>

      <div className="card mt16">
        <h3>{t('cg.committeeLatest')}</h3>
        <CongressTable rows={d.rows} />
        {d.total > d.rows.length && <p className="muted small mt8">{t('cg.committeeShown').replace('{n}', fmtNum(d.rows.length)).replace('{total}', fmtNum(d.total))}</p>}
        <p className="muted small mt8">{t('cg.committeeNote')}</p>
        <CongressDisclaimer />
      </div>
    </div>
  );
}
