import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { DataTable } from '../../components/DataTable.jsx';
import { EntityForm } from '../../components/EntityForm.jsx';
import { PageHeader } from '../../components/ui.jsx';
import { useData } from '../../lib/data.jsx';
import { ImportButton } from '../../components/ImportExcel.jsx';

export const supplierFields = [
  { key: 'name', label: 'Emri', required: true },
  { key: 'nipt', label: 'NIPT' },
  { key: 'contactPerson', label: 'Personi i kontaktit' },
  { key: 'phone', label: 'Telefoni', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'address', label: 'Adresa' },
  { key: 'paymentTerms', label: 'Kushtet e pagesës' },
  { key: 'notes', label: 'Shënime', type: 'textarea', span: 'all' },
  { key: 'active', label: 'Aktiv', type: 'checkbox' },
];

export default function Suppliers() {
  const { suppliers, products } = useData();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageHeader
        title="Furnitorët"
        subtitle="Kartela e furnitorëve me kontaktet, çmimet dhe historikun e blerjeve."
        actions={(
          <>
            <ImportButton type="suppliers" />
            <button type="button" className="btn primary" onClick={() => setEditing({})}><Plus size={16} /> Furnitor</button>
          </>
        )}
      />
      <DataTable
        title="Furnitorët"
        rows={suppliers}
        onRowClick={(s) => navigate(`/furnitoret/${s.id}`)}
        columns={[
          { key: 'name', label: 'Emri' },
          { key: 'nipt', label: 'NIPT' },
          { key: 'contactPerson', label: 'Kontakti' },
          { key: 'phone', label: 'Telefoni' },
          { key: 'email', label: 'Email' },
          { key: 'products', label: 'Artikuj', type: 'number', value: (s) => products.filter((p) => p.supplierId === s.id).length },
        ]}
      />
      {editing && (
        <EntityForm
          title="Furnitor i ri"
          collectionName="suppliers"
          defaults={{ active: true }}
          fields={supplierFields}
          onClose={() => setEditing(null)}
          onSaved={(s) => navigate(`/furnitoret/${s.id}`)}
        />
      )}
    </>
  );
}
