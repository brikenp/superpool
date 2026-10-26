// Hook-e për leximin e të dhënave në kohë reale nga Firestore,
// dhe një "DataProvider" që mban në memorie të dhënat bazë që përdoren kudo (artikuj, vende, klientë...).

import {
  collection, doc, onSnapshot, query as fsQuery,
} from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { CAPS } from '@shared/roles.js';

import { useAuth } from './auth.jsx';
import { db } from './firebase.js';

const toList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/**
 * Abonim në një query. `build` kthen query-n (ose null nëse nuk duhet ngarkuar asgjë).
 * `deps` rifillon abonimin kur ndryshojnë filtrat.
 */
export function useQuery(build, deps) {
  const [state, setState] = useState({ data: [], loading: true, error: null });
  useEffect(() => {
    const q = build();
    if (!q) {
      setState({ data: [], loading: false, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => setState({ data: toList(snap), loading: false, error: null }),
      (error) => {
        console.error(error);
        setState({ data: [], loading: false, error });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useCollection(path, enabled = true, ...constraints) {
  return useQuery(
    () => (enabled && path ? fsQuery(collection(db, path), ...constraints) : null),
    [path, enabled],
  );
}

export function useDocument(path) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    setState({ data: null, loading: true, error: null });
    return onSnapshot(
      doc(db, path),
      (snap) => setState({ data: snap.exists() ? { id: snap.id, ...snap.data() } : null, loading: false, error: null }),
      (error) => setState({ data: null, loading: false, error }),
    );
  }, [path]);
  return state;
}

const DataContext = createContext(null);

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

export function DataProvider({ children }) {
  const { caps, uid } = useAuth();
  const active = Boolean(uid) && caps.size > 0;
  const products = useCollection('products', active);
  const categories = useCollection('categories', active);
  const locations = useCollection('locations', active);
  const employees = useCollection('employees', active);
  const vehicles = useCollection('vehicles', active);
  const users = useCollection('users', active);
  const settings = useDocument(active ? 'settings/company' : null);
  const suppliers = useCollection('suppliers', active && (caps.has(CAPS.INVENTORY_VIEW) || caps.has(CAPS.SUPPLIERS)));
  const clients = useCollection('clients', active && caps.has(CAPS.CLIENTS_VIEW));
  const costs = useCollection('productCosts', active && caps.has(CAPS.VIEW_COSTS));

  const value = useMemo(() => {
    const sortBy = (f) => (a, b) => String(a[f] || '').localeCompare(String(b[f] || ''), 'sq');
    const productList = [...products.data].sort(sortBy('code'));
    return {
      loading: products.loading || locations.loading,
      products: productList,
      productsById: byId(productList),
      categories: [...categories.data].sort(sortBy('name')),
      categoriesById: byId(categories.data),
      locations: [...locations.data].sort(sortBy('name')),
      locationsById: byId(locations.data),
      employees: [...employees.data].sort(sortBy('name')),
      employeesById: byId(employees.data),
      vehicles: [...vehicles.data].sort(sortBy('plate')),
      vehiclesById: byId(vehicles.data),
      users: [...users.data].sort(sortBy('name')),
      usersById: byId(users.data),
      suppliers: [...suppliers.data].sort(sortBy('name')),
      suppliersById: byId(suppliers.data),
      clients: [...clients.data].sort(sortBy('name')),
      clientsById: byId(clients.data),
      costsById: byId(costs.data),
      company: { name: 'SuperPool', vatPct: 20, ...(settings.data || {}), loaded: !settings.loading },
      listsLoading: { clients: clients.loading, suppliers: suppliers.loading, products: products.loading, locations: locations.loading },
    };
  }, [clients.loading, suppliers.loading, products.data, products.loading, categories.data, locations.data, locations.loading, employees.data,
    vehicles.data, users.data, suppliers.data, clients.data, costs.data, settings.data, settings.loading]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => useContext(DataContext);

/** Kosto njësi e artikullit (kosto mesatare, ose çmimi i fundit i blerjes). */
export const unitCostOf = (costsById, productId) => {
  const c = costsById[productId];
  return Number(c?.avgCost || c?.purchasePrice || 0);
};

/** Vendet fizike ku mund të ndodhet malli. */
export const physicalLocations = (locations) => locations.filter((l) => !l.virtual && l.active !== false);
