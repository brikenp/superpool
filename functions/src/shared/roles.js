// Rolet dhe aftësitë (capabilities). Ky skedar përdoret nga Cloud Functions dhe nga aplikacioni web.
// Rregullat e Firestore (firestore.rules) pasqyrojnë të njëjtat role — mbajini të sinkronizuara.

export const ROLES = {
  admin: 'Administrator i programit',
  magazine: 'Përgjegjës i magazinës',
  oferta: 'Përgatitës i ofertave',
  projekte: 'Përgjegjës i projekteve',
  kimikate: 'Shitje kimikatesh (Gerti)',
  terren: 'Punonjës / përgjegjës automjeti',
  custom: 'I personalizuar (zgjedhje manuale)',
};

// Roli "custom": aftësitë ruhen te përdoruesi (users/{uid}.caps) dhe zgjidhen me dorë nga administratori.
export const CUSTOM_ROLE = 'custom';

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
  custom: [],
};

// Përshkrimi i çdo aftësie, i grupuar, për zgjedhjen manuale te roli i personalizuar.
export const CAP_GROUPS = [
  { title: 'Magazina', caps: {
    [C.INVENTORY_VIEW]: 'Shikim i artikujve dhe stokut',
    [C.INVENTORY_MANAGE]: 'Menaxhim i magazinës (artikuj, inventarizim, magazina)',
    [C.MOVEMENTS_CREATE]: 'Regjistrim lëvizjesh (dalje, kthime, dorëzime…)',
    [C.MOVEMENTS_APPROVE]: 'Miratim i lëvizjeve',
    [C.FIELD]: 'Ndërfaqja e terrenit (telefon)',
  } },
  { title: 'Flota dhe furnizimi', caps: {
    [C.FLEET]: 'Automjete dhe punonjës',
    [C.SUPPLIERS]: 'Furnitorë, çmime dhe porosi',
  } },
  { title: 'Klientët dhe shitjet', caps: {
    [C.CLIENTS_VIEW]: 'Shikim i klientëve',
    [C.CLIENTS_MANAGE]: 'Krijim / ndryshim klientësh',
    [C.CHEM_SALES]: 'Shitje kimikatesh (të vetat)',
    [C.CHEM_SALES_ALL]: 'Të gjitha shitjet e kimikateve',
    [C.FINANCE]: 'Fatura dhe pagesa',
  } },
  { title: 'Ofertat dhe projektet', caps: {
    [C.OFFERS]: 'Oferta dhe preventiva',
    [C.POOL_MODELS]: 'Modelet e pishinave',
    [C.PROJECTS_VIEW]: 'Shikim i projekteve',
    [C.PROJECTS_MANAGE]: 'Menaxhim i projekteve',
  } },
  { title: 'Kostot dhe raportet', caps: {
    [C.VIEW_COSTS]: 'Kosto blerjeje, marzh, preventiv i brendshëm',
    [C.REPORTS]: 'Raportet',
  } },
  { title: 'Administrimi', caps: {
    [C.INTEGRATION]: 'Integrimi / importi',
    [C.AUDIT]: 'Gjurmët e veprimeve',
    [C.USERS]: 'Përdoruesit dhe të dhënat e kompanisë',
  } },
];

export const CAP_LABELS = Object.assign({}, ...CAP_GROUPS.map((g) => g.caps));

/** Pastron listën e aftësive të zgjedhura me dorë (vetëm vlera të njohura, pa dublikime). */
export const sanitizeCaps = (caps) => [...new Set((Array.isArray(caps) ? caps : []).filter((c) => ALL.includes(c)))];

/** Aftësitë e një roli; për rolin e personalizuar merren nga lista `customCaps` e përdoruesit. */
export function capsForRole(role, customCaps) {
  if (role === CUSTOM_ROLE) return new Set(sanitizeCaps(customCaps));
  return new Set(ROLE_CAPS[role] || []);
}

export function hasCap(role, ...caps) {
  const owned = capsForRole(role);
  return caps.some((c) => owned.has(c));
}

/** Si hasCap, por për një dokument përdoruesi { role, caps } (mbështet edhe rolin e personalizuar). */
export function userHasCap(user, ...caps) {
  const owned = capsForRole(user?.role, user?.caps);
  return caps.some((c) => owned.has(c));
}
