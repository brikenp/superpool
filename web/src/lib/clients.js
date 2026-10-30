import { contactsText } from '../components/Contacts.jsx';

/** Emri i klientit me emrin tregtar në kllapa (p.sh. "Riviera Sh.p.k. (Hotel Riviera)"). */
export const clientLabel = (c) => (c?.tradeName && c.tradeName !== c.name ? `${c.name} (${c.tradeName})` : c?.name || '');

/** Opsion për SearchSelect: kërkohet edhe me emrin tregtar, NIPT-in dhe telefonin. */
export const clientOption = (c, sub = [c.nipt]) => ({
  value: c.id,
  label: clientLabel(c),
  sub: sub.filter(Boolean).join(' · '),
  search: [c.tradeName, c.nipt, c.phone, c.city, c.contactPerson, contactsText(c.contacts)].filter(Boolean).join(' '),
});
