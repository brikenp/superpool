# SuperPool — programi i menaxhimit

Program i personalizuar për SuperPool (ndërtim pishinash, pajisje dhe kimikate): magazina, automjetet,
punonjësit, projektet/kantieret, ofertat dhe preventivat, klientët, shitjet e kimikateve, furnitorët dhe porositë,
kostot e projekteve, raportet dhe lidhja me programin ekzistues të faturimit.

- **Teknologjia:** Node.js (Cloud Functions) + Firebase (Firestore, Authentication, Storage, Hosting) + React (Vite).
- **Pajisjet:** funksionon nga kompjuteri dhe telefoni (ndërfaqe responsive, mund të instalohet si aplikacion — PWA).
- **Gjuha e ndërfaqes:** shqip.

Propozimi teknik i plotë (modulet, siguria, fazat, mirëmbajtja): [`docs/PROPOZIMI_TEKNIK.md`](docs/PROPOZIMI_TEKNIK.md).

## Struktura

```
functions/            Cloud Functions (Node.js 22)
  src/shared/         Kodi i përbashkët me web-in: rolet, formulat, llogaritja e stokut
  src/lib/            Transaksionet e stokut, numërimi i dokumenteve, gjurmët
  src/handlers/       Lëvizjet, shitjet, porositë, projektet, përdoruesit, importi, trigger-at
  test/               Testet e njësive (node --test)
web/                  Aplikacioni React (Vite)
  src/pages/          Faqet sipas moduleve
  src/lib/            Firebase, eksport Excel/PDF, PDF e ofertave
  scripts/e2e.mjs     Testi end-to-end kundrejt emulatorëve
firestore.rules       Rregullat e aksesit sipas roleve
storage.rules         Aksesi në dokumentet e ngarkuara
```

## Si funksionon stoku

Çdo lëvizje malli është një dokument **nga** një vend **drejt** një vendi tjetër. Vendet janë: magazina kryesore,
nënmagazina e çdo automjeti (krijohet automatikisht), kantieri i çdo projekti (krijohet automatikisht),
nënmagazina e shitësit (Gerti), si dhe vende "virtuale" (furnitor, klient, përdorur në projekt, dëmtuar/humbur,
rregullim inventari). Kështu çdo material ndiqet nga hyrja deri te përdorimi ose shitja.

Stoku ndryshon **vetëm** nga Cloud Functions, brenda transaksioneve Firestore — klienti nuk mund të shkruajë sasi.
Dokumentet nga terreni (dalje, kthime, humbje) kalojnë "në pritje" deri në miratimin nga magazinieri/përgjegjësi.
Kostot (kosto mesatare e ponderuar, kosto e daljeve, marzhi) ruhen në koleksione të veçanta që nuk i lexojnë
punonjësit e terrenit dhe shitësi i kimikateve.

## Instalimi lokal

Kërkesat: Node.js 22, Java 17+ (për emulatorët), `npm i -g firebase-tools`.

```bash
npm run install:all
npm test                     # testet e njësive dhe kontrolli i sinkronizimit role ↔ rregulla
npm run emulators            # në një terminal tjetër
npm run e2e                  # rrjedha e plotë e biznesit me 5 role (17 kontrolle)
cd web && VITE_USE_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-superpool npm run dev
```

Hapni http://localhost:5173, krijoni një llogari te emulatori i Auth (ose përdorni ato të `npm run e2e`:
`admin@superpool.al` / `Fjalekalim123`). Përdoruesi i parë që shtyp "Konfigurimi fillestar" bëhet administrator.

## Vendosja në prodhim

1. Krijoni projektin në [Firebase Console](https://console.firebase.google.com) (plani **Blaze**, i nevojshëm për Cloud Functions),
   aktivizoni Authentication (Email/Password), Firestore (rajoni `europe-west1`) dhe Storage.
2. Vendosni ID-në e projektit te `.firebaserc`.
3. Kopjoni `web/.env.example` në `web/.env.local` dhe plotësoni konfigurimin e web app-it.
4. `firebase login` dhe pastaj `npm run deploy`.
5. Hyni me llogarinë e administratorit → "Konfigurimi fillestar" → plotësoni "Të dhënat e kompanisë" (logo, NIPT, kushtet e ofertës).
6. Importoni artikujt, klientët dhe stokun fillestar nga **Integrimi / importi** (Excel ose CSV).

Kopjet rezervë: aktivizoni *Firestore scheduled backups* (Console → Firestore → Disaster recovery) me ruajtje ditore 14+ ditë.

## Rolet

| Roli | Çfarë bën |
|---|---|
| Administrator | Gjithçka, përdoruesit, gjurmët e veprimeve |
| Përgjegjës i magazinës | Artikuj, hyrje/dalje, miratime, inventarizim, furnitorë, porosi, import |
| Përgatitës i ofertave | Klientë, oferta, modelet e pishinave, preventiv i brendshëm |
| Përgjegjës i projekteve | Projekte, rezervime, miratime, shpenzime, fatura/pagesa |
| Shitje kimikatesh (Gerti) | Shitje nga nënmagazina e vet, klientët — pa kosto, vetëm shitjet e veta |
| Punonjës / automjet | Ndërfaqja e terrenit: merr, dorëzon, përdor, kthen materiale; projektet ku është në ekip |

Matrica e plotë shfaqet te faqja **Përdoruesit**. Rolet përcaktohen te `functions/src/shared/roles.js`;
pas ndryshimit ekzekutoni `npm --prefix functions run sync-rules` që të përditësohen rregullat e Firestore.
