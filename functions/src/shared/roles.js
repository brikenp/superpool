// Rolet dhe aftësitë (capabilities). Ky skedar përdoret nga Cloud Functions dhe nga aplikacioni web.
// Rregullat e Firestore (firestore.rules) pasqyrojnë të njëjtat role — mbajini të sinkronizuara.

export const ROLES = {
  admin: 'Administrator i programit',
  magazine: 'Përgjegjës i magazinës',
  oferta: 'Përgatitës i ofertave',
  projekte: 'Përgjegjës i projekteve',
  kimikate: 'Shitje kimikatesh (Gerti)',
  terren: 'Punonjës / përgjegjës automjeti',
};

export const CAPS = {
  INVENTORY_VIEW: 'inventory_view', // artikuj dhe gjendje stoku
  INVENTORY_MANAGE: 'inventory_manage', // artikuj, kategori, vende magazinimi, inventarizim
  MOVEMENTS_CREATE: 'movements_create', // regjistrim lëvizjesh
  MOVEMENTS_APPROVE: 'movements_approve', // miratim i daljeve, kthimeve, humbjeve
  FLEET: 'fleet', // automjete dhe punonjës
  SUPPLIERS: 'suppliers', // furnitorë, çmime, porosi
  CLIENTS_VIEW: 'clients_view',
  CLIENTS_MANAGE: 'clients_manage',
  FINANCE: 'finance', // fatura dhe pagesa
  CHEM_SALES: 'chem_sales', // shitje kimikatesh (të vetat)
  CHEM_SALES_ALL: 'chem_sales_all', // të gjitha shitjet e kimikateve
  OFFERS: 'offers',
  POOL_MODELS: 'pool_models',
  PROJECTS_VIEW: 'projects_view',
  PROJECTS_MANAGE: 'projects_manage',
  VIEW_COSTS: 'view_costs', // kosto blerjeje, marzh, preventiv i brendshëm
  REPORTS: 'reports',
  INTEGRATION: 'integration',
  AUDIT: 'audit',
  USERS: 'users',
  FIELD: 'field', // ndërfaqja e thjeshtë për terren
};

const ALL = Object.values(CAPS);
const C = CAPS;

export const ROLE_CAPS = {
  admin: ALL,
  magazine: [
    C.INVENTORY_VIEW, C.INVENTORY_MANAGE, C.MOVEMENTS_CREATE, C.MOVEMENTS_APPROVE, C.FLEET, C.SUPPLIERS,
    C.CLIENTS_VIEW, C.CHEM_SALES, C.CHEM_SALES_ALL, C.PROJECTS_VIEW, C.VIEW_COSTS, C.REPORTS, C.INTEGRATION, C.FIELD,
  ],
  oferta: [
    C.INVENTORY_VIEW, C.CLIENTS_VIEW, C.CLIENTS_MANAGE, C.OFFERS, C.POOL_MODELS, C.PROJECTS_VIEW, C.VIEW_COSTS,
    C.REPORTS,
  ],
  projekte: [
    C.INVENTORY_VIEW, C.MOVEMENTS_CREATE, C.MOVEMENTS_APPROVE, C.CLIENTS_VIEW, C.OFFERS, C.PROJECTS_VIEW,
    C.PROJECTS_MANAGE, C.VIEW_COSTS, C.REPORTS, C.FINANCE, C.FIELD,
  ],
  kimikate: [C.CHEM_SALES, C.CLIENTS_VIEW, C.CLIENTS_MANAGE],
  terren: [C.FIELD, C.MOVEMENTS_CREATE],
};

export function capsForRole(role) {
  return new Set(ROLE_CAPS[role] || []);
}

export function hasCap(role, ...caps) {
  const owned = capsForRole(role);
  return caps.some((c) => owned.has(c));
}
