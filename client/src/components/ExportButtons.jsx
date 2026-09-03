import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { exportRowsToExcel } from '../lib/exportExcel.js';
import { downloadCsv } from '../lib/exportCsv.js';

// CSV / XLSX export for any table (Pro). `rows` is an array of flat objects
// (or a function returning one, so heavy mapping only runs on click).
export default function ExportButtons({ rows, name = 'export', compact = false }) {
  const { t } = useI18n();
  const { isPro } = useAuth();
  const [busy, setBusy] = useState(false);
  const get = () => (typeof rows === 'function' ? rows() : rows) || [];
  if (!isPro) return <Link to="/pricing" className="muted small" title={t('export.proOnly')}>⬇ {t('export.pro')}</Link>;
  const run = async (kind) => {
    setBusy(true);
    try {
      const data = get();
      if (!data.length) return;
      if (kind === 'csv') downloadCsv(data, `${name}.csv`);
      else await exportRowsToExcel(data, `${name}.xlsx`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn ghost" onClick={() => run('csv')} disabled={busy}>⬇ CSV</button>
      <button className="btn ghost" onClick={() => run('xlsx')} disabled={busy}>⬇ {compact ? 'XLSX' : 'Excel'}</button>
    </span>
  );
}
