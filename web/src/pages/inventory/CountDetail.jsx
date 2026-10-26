import { doc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { UNITS } from '@shared/constants.js';

import { Card, Loading, PageHeader, SearchSelect, StatusBadge, useAction, useUi } from '../../components/ui.jsx';
import { useData, useDocument } from '../../lib/data.jsx';
import { companyHeader } from '../../lib/docPdf.js';
import { loadPdf } from '../../lib/export.js';
import { call, db } from '../../lib/firebase.js';
import { date, qty, round3, toNumber } from '../../lib/format.js';
import { productOption } from '../../components/ProductImage.jsx';

const STATUS = { draft: 'Në numërim', confirmed: 'Konfirmuar', cancelled: 'Anuluar' };

export default function CountDetail() {
  const { id } = useParams();
  const { data: count, loading } = useDocument(`inventoryCounts/${id}`);
  const { products, productsById, company } = useData();
  const { ask } = useUi();
  const [lines, setLines] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [run, busy] = useAction();

  useEffect(() => {
    if (count && !dirty) setLines((count.lines || []).map((l) => ({ ...l, countedQty: l.countedQty ?? '' })));
  }, [count, dirty]);

  if (loading || !lines) return <Loading />;
  if (!count) return <div className="alert error">Inventarizimi nuk u gjet.</div>;
  const editable = count.status === 'draft';

  const update = (i, value) => { setDirty(true); setLines(lines.map((l, j) => (j === i ? { ...l, countedQty: value } : l))); };
  const addProduct = (productId) => {
    if (!productId || lines.some((l) => l.productId === productId)) return;
    const p = productsById[productId];
    setDirty(true);
    setLines([...lines, { productId, code: p.code, name: p.name, unit: p.unit, systemQty: 0, countedQty: '' }]);
  };
  const serialize = () => lines.map((l) => ({ ...l, countedQty: l.countedQty === '' ? null : toNumber(l.countedQty) }));
  const save = () => run(async () => {
    await updateDoc(doc(db, 'inventoryCounts', id), { lines: serialize() });
    setDirty(false);
  }, 'Numërimi u ruajt.');
  const confirm = async () => {
    const uncounted = lines.filter((l) => l.countedQty === '').length;
    const ok = await ask({
      title: 'Konfirmo inventarizimin',
      message: `Diferencat do të regjistrohen si lëvizje rregullimi.${uncounted ? `\n${uncounted} artikuj pa sasi të numëruar nuk do të ndryshohen.` : ''}`,
      confirmLabel: 'Konfirmo',
    });
    if (!ok) return;
    run(async () => {
      await updateDoc(doc(db, 'inventoryCounts', id), { lines: serialize() });
      setDirty(false);
      return call('confirmInventoryCount', { id });
    }, (r) => `U konfirmua: ${r.surplus} tepricë, ${r.shortage} mungesë.`);
  };
  const cancel = async () => {
    if (await ask({ title: 'Anulo inventarizimin', message: 'Fleta e numërimit do të anulohet pa ndryshuar stokun.', danger: true, confirmLabel: 'Anulo' })) {
      run(() => updateDoc(doc(db, 'inventoryCounts', id), { status: 'cancelled' }), 'U anulua.');
    }
  };
  const printSheet = () => run(async () => {
    const { jsPDF, autoTable } = await loadPdf();
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const y = companyHeader(pdf, company, 'Fletë numërimi', `${count.number} · ${count.locationName} · ${date(count.date)}`);
    autoTable(pdf, {
      startY: y,
      head: [['Kodi', 'Artikulli', 'Njësia', 'Sasia e numëruar', 'Shënim']],
      body: lines.map((l) => [l.code, l.name, UNITS[l.unit] || l.unit, l.countedQty === '' ? '' : qty(l.countedQty), '']),
      styles: { fontSize: 9, minCellHeight: 8 },
      headStyles: { fillColor: [25, 46, 65] },
    });
    pdf.save(`${count.number}.pdf`);
  });

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/inventarizim">Inventarizimi</Link>}
        title={`${count.number} · ${count.locationName}`}
        subtitle={<><StatusBadge status={count.status} labels={STATUS} /> · {date(count.date)}</>}
        actions={(
          <>
            <button type="button" className="btn" onClick={printSheet}>Fleta për numërim (PDF)</button>
            {editable && <button type="button" className="btn" disabled={busy || !dirty} onClick={save}>Ruaj</button>}
            {editable && <button type="button" className="btn primary" disabled={busy} onClick={confirm}>Konfirmo diferencat</button>}
            {editable && <button type="button" className="btn danger" disabled={busy} onClick={cancel}>Anulo</button>}
          </>
        )}
      />
      {count.status === 'confirmed' && (count.movementIds || []).length > 0 && (
        <div className="alert ok">
          Lëvizjet e rregullimit: {count.movementIds.map((m) => <Link key={m} to={`/levizjet/${m}`} style={{ marginRight: 8 }}>shiko</Link>)}
        </div>
      )}
      <Card>
        {editable && (
          <div style={{ maxWidth: 420, marginBottom: 12 }}>
            <SearchSelect
              options={products.filter((p) => !lines.some((l) => l.productId === p.id)).map((p) => productOption(p))}
              value=""
              placeholder="+ Shto artikull të gjetur fizikisht…"
              onChange={addProduct}
            />
          </div>
        )}
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr><th>Kodi</th><th>Artikulli</th><th className="r">Në sistem</th><th className="r">E numëruar</th><th className="r">Diferenca</th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const diff = l.countedQty === '' || l.countedQty === null ? null : round3(toNumber(l.countedQty) - Number(l.systemQty));
                const shownDiff = count.status === 'confirmed' ? l.difference : diff;
                return (
                  <tr key={l.productId}>
                    <td data-label="Kodi">{l.code}</td>
                    <td data-label="Artikulli">{l.name}</td>
                    <td data-label="Në sistem" className="r">{qty(l.systemQty)} {UNITS[l.unit] || ''}</td>
                    <td data-label="E numëruar" className="r">
                      {editable ? (
                        <input className="num" style={{ maxWidth: 120 }} type="number" step="any" inputMode="decimal" value={l.countedQty}
                          onChange={(e) => update(i, e.target.value)} />
                      ) : qty(l.countedQty)}
                    </td>
                    <td data-label="Diferenca" className={`r ${shownDiff > 0 ? 'text-ok' : shownDiff < 0 ? 'text-danger' : ''}`}>
                      {shownDiff === null || shownDiff === undefined ? '' : `${shownDiff > 0 ? '+' : ''}${qty(shownDiff)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && <p className="muted" style={{ fontSize: '0.85rem' }}>Sasia "në sistem" rillogaritet në momentin e konfirmimit.</p>}
      </Card>
    </>
  );
}
