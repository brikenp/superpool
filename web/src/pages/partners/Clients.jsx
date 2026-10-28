import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { EntityForm } from '../../components/EntityForm.jsx';
import { PageHeader } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData } from '../../lib/data.jsx';
import { NiptLookup } from '../../components/Fiscal.jsx';
import { ImportButton } from '../../components/ImportExcel.jsx';

export const clientFields = [
  { key: 'name', label: 'Emri / subjekti', required: true, span: 2 },
  { key: 'tradeName', label: 'Emri tregtar', hint: 'Emri me të cilin njihet (p.sh. emri i hotelit/dyqanit). Klienti gjendet edhe me këtë emër.' },
  { key: 'type', label: 'Lloji', type: 'select', required: true, options: [{ value: 'individual', label: 'Individ' }, { value: 'business', label: 'Biznes' }] },
  { key: 'nipt', label: 'NIPT', extra: NiptLookup, hint: 'Me POS.AL aktiv, emri dhe adresa plotësohen nga tatimet.' },
  { key: 'contactPerson', label: 'Personi i kontaktit' },
  { key: 'phone', label: 'Telefoni', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'city', label: 'Qyteti' },
  { key: 'address', label: 'Adresa', span: 2 },
  { key: 'billingId', label: 'ID në programin e faturimit', hint: 'Për lidhjen me programin ekzistues.' },
  { key: 'notes', label: 'Shënime', type: 'textarea', span: 'all' },
];

export const normalizeClient = (d) => ({ ...d, nipt: (d.nipt || '').toUpperCase().trim(), name: d.name.trim(), tradeName: (d.tradeName || '').trim() });

export default function Clients() {
  const { clients } = useData();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Klientët"
        subtitle="Kartela e vetme e klientit: oferta, projekte, shitje kimikatesh, fatura dhe pagesa."
        actions={can(CAPS.CLIENTS_MANAGE, CAPS.FINANCE) && (
          <>
            <ImportButton type="clients" />
            <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Klient</button>
          </>
        )}
      />
      <DataTable
        title="Klientët"
        rows={clients}
        onRowClick={(c) => navigate(`/klientet/${c.id}`)}
        columns={[
          { key: 'name', label: 'Emri' },
          { key: 'tradeName', label: 'Emri tregtar' },
          { key: 'nipt', label: 'NIPT' },
          { key: 'phone', label: 'Telefoni' },
          { key: 'email', label: 'Email' },
          { key: 'city', label: 'Qyteti' },
          { key: 'type', label: 'Lloji', value: (c) => (c.type === 'business' ? 'Biznes' : 'Individ') },
        ]}
      />
      {creating && (
        <EntityForm
          title="Klient i ri"
          collectionName="clients"
          defaults={{ type: 'individual' }}
          fields={clientFields}
          transform={(d) => {
            const dup = d.nipt && clients.find((c) => c.nipt && c.nipt.toUpperCase() === d.nipt.toUpperCase().trim());
            if (dup) throw new Error(`Klienti me NIPT ${d.nipt} ekziston: ${dup.name}`);
            return normalizeClient(d);
          }}
          onClose={() => setCreating(false)}
          onSaved={(c) => navigate(`/klientet/${c.id}`)}
        />
      )}
    </>
  );
}
