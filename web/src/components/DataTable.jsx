import { useMemo, useState } from 'react';

import { exportExcel, exportPdf } from '../lib/export.js';
import { useData } from '../lib/data.jsx';
import { money, qty as fmtQty } from '../lib/format.js';
import { Empty, useAction } from './ui.jsx';

/**
 * Tabelë me kërkim, renditje, totale dhe eksport Excel/PDF.
 *
 * columns: [{
 *   key, label,
 *   value?: (row) => vlera e papërpunuar (për renditje/eksport); parazgjedhje row[key]
 *   render?: (row) => JSX
 *   type?: 'money' | 'number' | 'text'
 *   total?: true  (shfaq totalin në fund)
 *   hidden?: true
 * }]
 */
export function DataTable({
  columns, rows, title, onRowClick, search = true, exportable = true, filtersText = [], empty,
  initialSort, pageSize = 200, toolbar,
}) {
  const { company } = useData();
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState(initialSort || null);
  const [limit, setLimit] = useState(pageSize);
  const [run, busy] = useAction();
  const cols = columns.filter((c) => !c.hidden);
  const valueOf = (c, r) => (c.value ? c.value(r) : r[c.key]);

  const filtered = useMemo(() => {
    const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let list = rows;
    if (words.length) {
      list = rows.filter((r) => {
        const hay = cols.map((c) => String(valueOf(c, r) ?? '')).join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
    if (sort) {
      const c = cols.find((x) => x.key === sort.key);
      if (c) {
        const dir = sort.dir === 'desc' ? -1 : 1;
        list = [...list].sort((a, b) => {
          const va = valueOf(c, a);
          const vb = valueOf(c, b);
          if (typeof va === 'number' || typeof vb === 'number') return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
          return String(va ?? '').localeCompare(String(vb ?? ''), 'sq') * dir;
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, term, sort, columns]);

  const totals = useMemo(() => {
    const t = {};
    cols.filter((c) => c.total).forEach((c) => {
      t[c.key] = filtered.reduce((s, r) => s + (Number(valueOf(c, r)) || 0), 0);
    });
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, columns]);
  const hasTotals = Object.keys(totals).length > 0;

  const exportCols = cols.filter((c) => c.export !== false).map((c) => ({ label: c.label, type: c.type, value: (r) => valueOf(c, r) }));
  const doExport = (kind) => run(async () => {
    const payload = {
      title: title || 'Raport',
      columns: exportCols,
      rows: filtered,
      filters: [...filtersText, term ? `Kërkimi: ${term}` : ''].filter(Boolean),
      company,
      totals: hasTotals ? Object.fromEntries(cols.filter((c) => c.total).map((c) => [c.label, totals[c.key]])) : undefined,
    };
    if (kind === 'xlsx') await exportExcel(payload);
    else await exportPdf(payload);
  });

  const toggleSort = (c) => {
    if (c.sortable === false) return;
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }));
  };

  const fmt = (c, v) => {
    if (c.type === 'money') return money(v);
    if (c.type === 'number') return fmtQty(v);
    return v;
  };

  return (
    <div>
      {(search || exportable || toolbar) && (
        <div className="table-tools">
          {search && (
            <input className="search" type="search" placeholder="Kërko…" value={term} onChange={(e) => setTerm(e.target.value)} />
          )}
          {toolbar}
          <span className="count">{filtered.length} rreshta</span>
          {exportable && (
            <span className="row right">
              <button type="button" className="btn small" disabled={busy || !filtered.length} onClick={() => doExport('xlsx')}>Excel</button>
              <button type="button" className="btn small" disabled={busy || !filtered.length} onClick={() => doExport('pdf')}>PDF</button>
            </span>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="table responsive">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`${c.type === 'money' || c.type === 'number' || c.align === 'r' ? 'r' : ''} ${c.sortable === false ? '' : 'sortable'}`} onClick={() => toggleSort(c)}>
                  {c.label}
                  {sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((r) => (
              <tr key={r.id} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {cols.map((c) => (
                  <td key={c.key} data-label={c.label} className={c.type === 'money' || c.type === 'number' || c.align === 'r' ? 'r' : ''}>
                    {c.render ? c.render(r) : fmt(c, valueOf(c, r))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasTotals && filtered.length > 0 && (
            <tfoot>
              <tr>
                {cols.map((c, i) => (
                  <td key={c.key} data-label={c.label} className={c.total ? 'r' : ''}>
                    {c.total ? fmt(c, totals[c.key]) : i === 0 ? 'Totali' : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {!filtered.length && <Empty>{empty || 'Nuk ka të dhëna.'}</Empty>}
      </div>
      {filtered.length > limit && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => setLimit((l) => l + pageSize)}>
            Shfaq më shumë ({filtered.length - limit} të tjera)
          </button>
        </div>
      )}
    </div>
  );
}
