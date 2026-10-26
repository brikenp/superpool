import { Printer } from 'lucide-react';

import { CAPS } from '@shared/roles.js';

import { useAuth } from '../lib/auth.jsx';
import { useData } from '../lib/data.jsx';
import { invoicePdf, paymentPdf, printMovement } from '../lib/printDocs.js';
import { useAction } from './ui.jsx';

/** Butoni i vogël "PDF / Printo" për një rresht tabele (nuk hap rreshtin kur klikohet). */
function PrintButton({ onPrint, label = 'PDF / Printo' }) {
  const [run, busy] = useAction();
  return (
    <button type="button" className="icon-btn" title={label} aria-label={label} disabled={busy}
      onClick={(e) => { e.stopPropagation(); run(onPrint); }}>
      <Printer size={16} />
    </button>
  );
}

export function PrintInvoiceButton({ invoice }) {
  const { company, clientsById } = useData();
  return <PrintButton label="PDF / Printo faturën" onPrint={() => invoicePdf(invoice, { company, clientsById })} />;
}

export function PrintPaymentButton({ payment }) {
  const { company, clientsById } = useData();
  return <PrintButton label="PDF / Printo mandatin" onPrint={() => paymentPdf(payment, { company, clientsById })} />;
}

export function PrintMovementButton({ movement }) {
  const data = useData();
  const { can } = useAuth();
  return <PrintButton label="PDF / Printo dokumentin" onPrint={() => printMovement(movement, { ...data, showCosts: can(CAPS.VIEW_COSTS) })} />;
}

// Kolona gati për DataTable (nuk del në eksportin Excel/PDF të tabelës).
export const printColumn = (render) => ({ key: '_print', label: '', export: false, sortable: false, value: () => '', render });
