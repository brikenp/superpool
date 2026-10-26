import { Link } from 'react-router-dom';

import { PAYMENT_METHODS, UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { Card, Loading, PageHeader, StatusBadge, useAction, useUi } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useDocument } from '../../lib/data.jsx';
import { companyHeader } from '../../lib/docPdf.js';
import { loadPdf } from '../../lib/export.js';
import { call } from '../../lib/firebase.js';
import { date, money, qty } from '../../lib/format.js';
import { INVOICE_STATUS } from '../finance/Finance.jsx';
import { SALE_STATUS } from './Sales.jsx';
import { useRouteId } from '../../lib/prettyUrl.jsx';

export default function SaleDetail() {
  const id = useRouteId();
  const { can } = useAuth();
  const { ask } = useUi();
  const { company } = useData();
  const { data: sale, loading } = useDocument(`sales/${id}`);
  const invoice = useDocument(sale?.invoiceId ? `invoices/${sale.invoiceId}` : null);
  const [run, busy] = useAction();

  if (loading) return <Loading />;
  if (!sale) return <div className="alert error">Shitja nuk u gjet ose nuk keni akses.</div>;

  const cancel = async () => {
    const reason = await ask({ title: 'Anulo shitjen', message: 'Malli kthehet në stok dhe fatura/pagesa anulohen.', input: 'Arsyeja', danger: true, confirmLabel: 'Anulo shitjen' });
    if (reason) run(() => call('cancelSale', { id, reason }), 'Shitja u anulua.');
  };

  // Dokument shoqërues (jo faturë fiskale) — fatura fiskale lëshohet nga programi i faturimit.
  const pdf = () => run(async () => {
    const { jsPDF, autoTable } = await loadPdf();
    const d = new jsPDF({ unit: 'mm', format: 'a5' });
    const y = companyHeader(d, company, 'Fletë shitjeje', `${sale.number} · ${date(sale.date)}`);
    d.setFontSize(9);
    d.text([`Klienti: ${sale.clientName}${sale.clientNipt ? ` (NIPT ${sale.clientNipt})` : ''}`, `Pagesa: ${PAYMENT_METHODS[sale.paymentMethod]}`], 10, y);
    autoTable(d, {
      startY: y + 10,
      margin: { left: 10, right: 10 },
      head: [['Produkti', 'Sasia', 'Çmimi', 'Vlera']],
      body: sale.lines.map((l) => [l.name, `${qty(l.qty)} ${UNITS[l.unit] || ''}`, money(l.unitPrice), money(l.total)]),
      foot: [['Totali me TVSH', '', '', money(sale.total)]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [25, 46, 65] },
      footStyles: { fillColor: [235, 242, 247], textColor: 20 },
    });
    d.setFontSize(7);
    d.text('Ky dokument nuk është faturë tatimore. Fatura fiskale lëshohet veçmas.', 10, d.lastAutoTable.finalY + 8);
    d.save(`${sale.number}.pdf`);
  });

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/kimikate">Shitjet</Link>}
        title={`${sale.number} · ${sale.clientName}`}
        subtitle={<><StatusBadge status={sale.status} labels={SALE_STATUS} /> · {date(sale.date)} · {sale.sellerName}</>}
        actions={(
          <>
            <button type="button" className="btn" onClick={pdf}>Fletë shitjeje (PDF)</button>
            {sale.status === 'confirmed' && can(CAPS.CHEM_SALES_ALL, CAPS.MOVEMENTS_APPROVE) && <button type="button" className="btn danger" disabled={busy} onClick={cancel}>Anulo</button>}
          </>
        )}
      />
      {sale.status === 'cancelled' && <div className="alert error">Anuluar: {sale.cancelReason}</div>}
      <div className="grid grid-2">
        <Card title="Të dhënat">
          <dl className="props">
            <dt>Klienti</dt><dd><Link to={`/klientet/${sale.clientId}`}>{sale.clientName}</Link></dd>
            <dt>Nga stoku</dt><dd>{sale.locationName}</dd>
            <dt>Pagesa</dt><dd>{PAYMENT_METHODS[sale.paymentMethod]}</dd>
            <dt>Lëvizja e stokut</dt><dd><Link to={`/levizjet/${sale.movementId}`}>shiko</Link></dd>
            {sale.productionId && <><dt>Fletë prodhimi</dt><dd><Link to={`/levizjet/${sale.productionId}`}>{sale.productionNumber}</Link> <small className="muted">(prodhimi i sasisë që mungonte)</small></dd></>}
          </dl>
          {sale.notes && <p>{sale.notes}</p>}
        </Card>
        <Card title="Fatura">
          {invoice.data ? (
            <dl className="props">
              <dt>Statusi</dt><dd><StatusBadge status={invoice.data.status} labels={INVOICE_STATUS} /></dd>
              <dt>Nr. fiskal</dt><dd>{invoice.data.fiscalNumber || <span className="text-warn">në pritje — lëshojeni në programin e faturimit</span>}</dd>
              <dt>Nr. i brendshëm</dt><dd>{invoice.data.internalNumber}</dd>
              <dt>Vlera</dt><dd>{money(invoice.data.amount)}</dd>
            </dl>
          ) : <span className="muted">—</span>}
          {can(CAPS.FINANCE) && <p><Link to={`/klientet/${sale.clientId}`}>Regjistro numrin fiskal te kartela e klientit → Faturat</Link></p>}
        </Card>
      </div>
      <Card title="Produktet">
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Kodi</th><th>Produkti</th><th className="r">Sasia</th><th className="r">Çmimi</th><th className="r">Vlera</th></tr></thead>
            <tbody>
              {sale.lines.map((l, i) => (
                <tr key={i}>
                  <td data-label="Kodi">{l.code}</td>
                  <td data-label="Produkti">{l.name}</td>
                  <td data-label="Sasia" className="r">{qty(l.qty)} {UNITS[l.unit] || ''}</td>
                  <td data-label="Çmimi" className="r">{money(l.unitPrice)}</td>
                  <td data-label="Vlera" className="r">{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Totali me TVSH</td><td className="r">{money(sale.total)}</td></tr></tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}
