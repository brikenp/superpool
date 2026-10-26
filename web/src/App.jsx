import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import { CAPS } from '@shared/roles.js';

import { Layout } from './components/Layout.jsx';
import { Empty, Loading } from './components/ui.jsx';
import { useAuth } from './lib/auth.jsx';
import { DataProvider } from './lib/data.jsx';
import { entityPage } from './lib/prettyUrl.jsx';
import Login from './pages/Login.jsx';
import Setup from './pages/Setup.jsx';

const C = CAPS;
const page = (loader) => lazy(loader);

const Dashboard = page(() => import('./pages/Dashboard.jsx'));
const FieldHome = page(() => import('./pages/field/FieldHome.jsx'));
const Products = page(() => import('./pages/inventory/Products.jsx'));
const ProductDetail = page(() => import('./pages/inventory/ProductDetail.jsx'));
const Stock = page(() => import('./pages/inventory/Stock.jsx'));
const Movements = page(() => import('./pages/inventory/Movements.jsx'));
const MovementForm = page(() => import('./pages/inventory/MovementForm.jsx'));
const MovementDetail = page(() => import('./pages/inventory/MovementDetail.jsx'));
const Contracts = page(() => import('./pages/finance/Contracts.jsx'));
const ContractDetail = page(() => import('./pages/finance/Contracts.jsx').then((m) => ({ default: m.ContractDetail })));
const ProductionForm = page(() => import('./pages/inventory/ProductionForm.jsx'));
const Counts = page(() => import('./pages/inventory/Counts.jsx'));
const CountDetail = page(() => import('./pages/inventory/CountDetail.jsx'));
const Fiscal = page(() => import('./pages/inventory/Fiscal.jsx'));
const Locations = page(() => import('./pages/inventory/Locations.jsx'));
const LocationDetail = page(() => import('./pages/inventory/LocationDetail.jsx'));
const Vehicles = page(() => import('./pages/fleet/Vehicles.jsx'));
const Employees = page(() => import('./pages/fleet/Employees.jsx'));
const Suppliers = page(() => import('./pages/partners/Suppliers.jsx'));
const SupplierDetail = page(() => import('./pages/partners/SupplierDetail.jsx'));
const PurchaseOrders = page(() => import('./pages/partners/PurchaseOrders.jsx'));
const PurchaseOrderDetail = page(() => import('./pages/partners/PurchaseOrderDetail.jsx'));
const Needs = page(() => import('./pages/partners/Needs.jsx'));
const Clients = page(() => import('./pages/partners/Clients.jsx'));
const ClientCard = page(() => import('./pages/partners/ClientCard.jsx'));
const Sales = page(() => import('./pages/sales/Sales.jsx'));
const SaleForm = page(() => import('./pages/sales/SaleForm.jsx'));
const SaleDetail = page(() => import('./pages/sales/SaleDetail.jsx'));
const Offers = page(() => import('./pages/offers/Offers.jsx'));
const OfferEditor = page(() => import('./pages/offers/OfferEditor.jsx'));
const PoolModels = page(() => import('./pages/offers/PoolModels.jsx'));
const PoolModelEditor = page(() => import('./pages/offers/PoolModelEditor.jsx'));
const Projects = page(() => import('./pages/projects/Projects.jsx'));
const ProjectDetail = page(() => import('./pages/projects/ProjectDetail.jsx'));
const Finance = page(() => import('./pages/finance/Finance.jsx'));
const Reports = page(() => import('./pages/reports/Reports.jsx'));
const Integration = page(() => import('./pages/admin/Integration.jsx'));
const Users = page(() => import('./pages/admin/Users.jsx'));
const Settings = page(() => import('./pages/admin/Settings.jsx'));
const Audit = page(() => import('./pages/admin/Audit.jsx'));

function Guard({ caps, children }) {
  const { can } = useAuth();
  if (caps && !can(...caps)) return <Empty>Nuk keni akses në këtë faqe.</Empty>;
  return children;
}

const ROUTES = [
  ['/', Dashboard],
  ['/terren', FieldHome, [C.FIELD]],
  ['/artikuj', Products, [C.INVENTORY_VIEW]],
  ['/artikuj/:id', entityPage('products', ProductDetail), [C.INVENTORY_VIEW]],
  ['/stoku', Stock, [C.INVENTORY_VIEW]],
  ['/levizjet', Movements, [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE]],
  ['/levizjet/re/:kind', MovementForm, [C.MOVEMENTS_CREATE]],
  ['/levizjet/:id', entityPage('movements', MovementDetail)],
  ['/levizjet/:id/ndrysho', entityPage('movements', MovementForm), [C.MOVEMENTS_CREATE]],
  ['/prodhimi/i-ri', ProductionForm, [C.INVENTORY_MANAGE, C.MOVEMENTS_APPROVE]],
  ['/inventarizim', Counts, [C.INVENTORY_MANAGE]],
  ['/inventarizim/:id', entityPage('inventoryCounts', CountDetail), [C.INVENTORY_MANAGE]],
  ['/rakordimi', Fiscal, [C.INVENTORY_MANAGE]],
  ['/vendet', Locations, [C.INVENTORY_MANAGE]],
  ['/vendet/:id', entityPage('locations', LocationDetail)],
  ['/automjetet', Vehicles, [C.INVENTORY_VIEW, C.FLEET]],
  ['/punonjesit', Employees, [C.FLEET]],
  ['/furnitoret', Suppliers, [C.SUPPLIERS]],
  ['/furnitoret/:id', entityPage('suppliers', SupplierDetail), [C.SUPPLIERS]],
  ['/porosite', PurchaseOrders, [C.SUPPLIERS]],
  ['/porosite/nevojat', Needs, [C.SUPPLIERS]],
  ['/porosite/:id', entityPage('purchaseOrders', PurchaseOrderDetail), [C.SUPPLIERS]],
  ['/klientet', Clients, [C.CLIENTS_VIEW]],
  ['/klientet/:id', entityPage('clients', ClientCard), [C.CLIENTS_VIEW]],
  ['/kimikate', Sales, [C.CHEM_SALES]],
  ['/kimikate/shitje-e-re', SaleForm, [C.CHEM_SALES]],
  ['/kimikate/nenmagazina', Sales, [C.CHEM_SALES]],
  ['/kimikate/:id', entityPage('sales', SaleDetail), [C.CHEM_SALES, C.REPORTS]],
  ['/ofertat', Offers, [C.OFFERS]],
  ['/ofertat/:id', entityPage('offers', OfferEditor), [C.OFFERS]],
  ['/modelet', PoolModels, [C.POOL_MODELS]],
  ['/modelet/:id', PoolModelEditor, [C.POOL_MODELS]],
  ['/projektet', Projects, [C.PROJECTS_VIEW, C.FIELD]],
  ['/projektet/:id', entityPage('projects', ProjectDetail), [C.PROJECTS_VIEW, C.FIELD]],
  ['/kontratat', Contracts, [C.FINANCE, C.PROJECTS_MANAGE, C.REPORTS]],
  ['/kontratat/:id', entityPage('contracts', ContractDetail), [C.FINANCE, C.PROJECTS_MANAGE, C.REPORTS]],
  ['/financa', Finance, [C.FINANCE, C.REPORTS]],
  ['/financa/:section', Finance, [C.FINANCE, C.REPORTS]],
  ['/raportet', Reports, [C.REPORTS]],
  ['/raportet/:key', Reports, [C.REPORTS]],
  ['/integrimi', Integration, [C.INTEGRATION]],
  ['/perdoruesit', Users, [C.USERS]],
  ['/cilesimet', Settings, [C.USERS]],
  ['/gjurmet', Audit, [C.AUDIT]],
];

export default function App() {
  const { loading, firebaseUser, role } = useAuth();
  if (loading) return <Loading />;
  if (!firebaseUser) return <Login />;
  if (!role) return <Setup />;
  return (
    <DataProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Layout />}>
            {ROUTES.map(([path, Component, caps]) => (
              <Route key={path} path={path} element={<Guard caps={caps}><Component /></Guard>} />
            ))}
            <Route path="*" element={<Empty>Faqja nuk u gjet.</Empty>} />
          </Route>
        </Routes>
      </Suspense>
    </DataProvider>
  );
}
