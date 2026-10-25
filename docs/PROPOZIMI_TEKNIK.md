# SuperPool — Propozimi teknik

Përgjigje ndaj pikës 14 të specifikimeve funksionale. Shifrat e afateve janë vlerësime pune;
kostot periodike janë sipas çmimeve publike të Google Cloud/Firebase dhe duhen konfirmuar në kohën e nënshkrimit.

## 1. Zgjidhja teknike

| Shtresa | Teknologjia | Pse |
|---|---|---|
| Ndërfaqja | React + Vite, aplikacion web responsive (PWA) | Një aplikacion i vetëm për kompjuter dhe telefon, pa instalim nga dyqanet |
| Logjika e biznesit | Node.js 22 në Firebase Cloud Functions | Veprimet që prekin stokun bëhen në server, në transaksione |
| Baza e të dhënave | Cloud Firestore (rajoni europe-west1) | Përditësim në kohë reale te të gjithë përdoruesit; punon edhe me sinjal të dobët (cache lokale) |
| Identifikimi | Firebase Authentication (email + fjalëkalim) | Llogari për çdo punonjës, çaktivizim i menjëhershëm |
| Dokumentet | Firebase Storage | Kontrata, foto kantieri, PDF |
| Hostimi i ndërfaqes | Vercel (HTTPS, CDN) | Publikim automatik nga GitHub, pa server për t'u mirëmbajtur |

Parime:
- **Stoku nuk ndryshohet kurrë direkt nga aplikacioni.** Çdo lëvizje kalon nga një funksion në server që kontrollon të drejtat,
  stokun e mjaftueshëm dhe shkruan në mënyrë atomike: gjendjen, koston mesatare, materialet e projektit dhe gjurmën.
- **Dokument për çdo lëvizje**, me numër (HYR-, DAL-, DOR-, PRD-, KTH-, SHT-, HUM-, INV-…), datë, person përgjegjës dhe autorizues.
- **Kostot janë të ndara** nga të dhënat që shohin punonjësit e terrenit dhe shitësi.

## 2. Modulet

| Moduli | Përmbajtja | Pika në specifikim |
|---|---|---|
| Magazina | Artikuj (kod, emër, përshkrim teknik, markë, model, njësi, furnitor, çmim blerjeje, kosto mesatare, stok fizik/rezervuar/i lirë, historik), fletëhyrje, dalje, transferime, inventarizim, rregullime | 2.1 |
| Rakordimi fiskal | Import i gjendjes fiskale, krahasim me stokun fizik, hyrje pa dokument fiskal, shitje pa numër fiskal | 2.2 |
| Automjetet | Nënmagazinë për çdo targë, përgjegjësi, materialet në automjet, historiku | 2.3 |
| Terreni (telefon) | Merr materiale, dorëzo në kantier, regjistro përdorimin, kthe materialet, dëmtim/humbje, projektet e mia | 2.4, 2.5, 10 |
| Kthimet | Kthim "në pritje" → magazinieri konfirmon gjendjen; i dëmtuari/humburi nuk hyn në stok | 2.5 |
| Kantieret | Nënmagazinë për çdo projekt: materialet e dorëzuara por të papërdorura | 2.6 |
| Kimikatet / Gerti | Nënmagazina e Gertit, dalje drejt tij, shitje me klient/datë/mënyrë pagese, faturë në pritje të numrit fiskal, rakordim marrë/shitur/mbetur | 3 |
| Furnitorët | Kartela, çmimet/ofertat e furnitorëve, krahasimi, porositë, pranimi i pjesshëm, lista e nevojave (stok minimal + mungesat e projekteve – në porosi) | 4 |
| Ofertat | Biblioteka e modeleve me formula (`ceil(P/6)`, `S*1.1`, `if(V>60,2,1)`…), llogaritje automatike nga përmasat, korrigjim manual, PDF për klientin, preventiv i brendshëm me kosto/marzh/nevoja porosie | 5 |
| Projektet | Oferta e pranuar → projekt; rezervim materialesh; pasqyra planifikuar/blerë/dalë/përdorur/kthyer/humbur/në kantier/në automjete; detyra; dokumente; shpenzime (orë pune × kosto/orë) | 6, 8 |
| Klientët | Kartela e vetme: oferta, projekte, shitje, fatura, pagesa, detyrime, dokumente dhe shënime | 7 |
| Financat | Fatura (numri fiskal nga programi i faturimit), pagesa, detyrimet e papaguara dhe me afat të kaluar | 7, 8 |
| Raportet | 10 raportet e kërkuara me filtra (periudhë, klient, projekt, furnitor, automjet, punonjës, artikull), eksport Excel/PDF | 12 |
| Administrimi | Përdoruesit dhe rolet, të dhënat e kompanisë dhe logoja, gjurmët e veprimeve, importi | 9, 11 |

## 3. Përdorimi nga kompjuteri dhe telefoni

Një adresë e vetme (p.sh. `app.superpool.al`). Në telefon faqja përshtatet automatikisht; punonjësit e terrenit
shohin direkt ekranin "Terreni" me butona të mëdhenj. Mund të shtohet në ekranin kryesor të telefonit si aplikacion.
Të dhënat ruhen në cache lokale, që leximi të funksionojë edhe me sinjal të dobët; veprimet që ndryshojnë stokun
kërkojnë lidhje (që të mos ketë konflikte sasish).

## 4. Integrimi me programin ekzistues të faturimit

Programi i faturimit **mbetet burimi zyrtar i faturave fiskale**; SuperPool është burimi i lëvizjeve fizike të mallit.

Faza e parë (gati): shkëmbim me Excel/CSV
- Import: artikuj, klientë, furnitorë, fatura (me numrin fiskal), pagesa, gjendje fiskale, stok fillestar.
- Eksport: shitjet që presin faturë fiskale.
- Lidhja automatike e numrit fiskal me shitjen përmes kolonës `saleNumber`.

Faza e dytë: integrim i drejtpërdrejtë, pasi të verifikohet programi aktual (emri/versioni, API ose eksport automatik,
baza e të dhënave). Arkitektura e ka gati pikën e hyrjes (`functions/src/handlers/integration.js`): mjafton një "adapter"
që lexon nga API-ja dhe thërret të njëjtat funksione importi, i planifikuar p.sh. çdo 15 minuta.

**Duhet nga SuperPool:** emri i programit të faturimit, kontakti i furnizuesit të tij, një eksport shembull i faturave dhe artikujve.

## 5. Afatet (vlerësim)

| Faza | Përmbajtja | Gjendja / afati |
|---|---|---|
| 1. Magazina | Artikuj, hyrje, dalje, automjete, punonjës, projekte, kthime | E zhvilluar — 2 javë testim me të dhëna reale |
| 2. Furnitorët dhe kimikatet | Porosi, nënmagazina e Gertit, shitje, historiku | E zhvilluar — testim bashkë me fazën 1 |
| 3. Klientët dhe ofertat | Kartelat, modelet, përllogaritja, PDF | E zhvilluar — 1–2 javë për futjen e modeleve reale të SuperPool dhe formatimin e ofertës |
| 4. Projektet dhe kostot | Rezervime, konsumi, kosto reale, raporte | E zhvilluar — testim në 1–2 projekte pilot |
| 5. Integrimi | Lidhja e drejtpërdrejtë me programin e faturimit | 2–4 javë pas verifikimit të programit ekzistues |

## 6. Kostot periodike (infrastruktura)

Firebase plani Blaze (paguaj sa përdor). Për një kompani me ~10–20 përdorues dhe disa mijëra dokumente në muaj,
përdorimi zakonisht qëndron brenda ose afër kuotave falas të Firestore/Functions dhe të planit falas të Vercel (Hobby; për përdorim tregtar rekomandohet Pro, ~20 $/muaj) — kosto e pritshme
**0–25 €/muaj**, plus kopjet rezervë të Firestore (disa €/muaj sipas madhësisë). Domeni: ~15 €/vit.
Rekomandohet vendosja e një buxheti/alarmi në Google Cloud Billing.

Kostoja e zhvillimit dhe e mirëmbajtjes vendoset me marrëveshje mes palëve (nuk përfshihet këtu).

## 7. Ruajtja dhe siguria e të dhënave

- Të dhënat në Google Cloud, rajoni Evropë (Belgjikë), të enkriptuara në ruajtje dhe në transmetim (HTTPS).
- Rregulla aksesi në server (`firestore.rules`, `storage.rules`) për çdo koleksion dhe rol — nuk varen nga ndërfaqja.
  Punonjësit shohin vetëm automjetin dhe projektet e tyre; Gerti vetëm shitjet e veta dhe pa kosto.
- Sasitë e stokut dhe kostot shkruhen vetëm nga Cloud Functions.
- Gjurmë për çdo krijim, ndryshim, fshirje, konfirmim, miratim, refuzim, anulim dhe import (kush, kur, çfarë ndryshoi).
- Çaktivizimi i një përdoruesi i bllokon menjëherë aksesin.
- Kopje rezervë ditore e Firestore (scheduled backups) dhe mundësi eksporti i plotë në çdo kohë.

## 8. Testimi, trajnimi dhe mirëmbajtja

- **Teste automatike:** testet e njësive (formula, stoku, kosto mesatare, rolet, sinkronizimi rol↔rregulla) dhe testi
  end-to-end me 5 role që kalon gjithë ciklin (blerje → ofertë → projekt → rezervim → dalje → dorëzim → përdorim →
  kthim me mall të dëmtuar → shitje e Gertit → import fature → inventarizim → anulim → porosi) dhe verifikon që
  rregullat e sigurisë bllokojnë veprimet e palejuara.
- **Testimi me përdoruesit:** 2 javë paralel me mënyrën aktuale të punës, në një projekt pilot dhe me Gertin.
- **Trajnimi:** 1 seancë për administratorin/magazinierin, 1 për ofertat/projektet, 30 min për punonjësit e terrenit (telefon).
- **Mirëmbajtja:** përditësime sigurie të librarive, monitorim i gabimeve, ndihmë për përdoruesit, përmirësime sipas nevojave.

## 9. Pronësia

Rekomandohet: kodi burimor, të dhënat dhe projekti Firebase janë pronë e SuperPool (llogaria Google e kompanisë
është pronare e projektit; zhvilluesi ka akses si bashkëpunëtor). Të dhënat mund të eksportohen në çdo kohë.
Libraritë e përdorura janë me licenca të hapura (MIT/Apache).

## Hapat e ardhshëm që kërkojnë vendim nga SuperPool

1. **Programi i faturimit:** cili është, dhe a ka API/eksport automatik?
2. **Gerti:** nënmagazinë e dedikuar (e zhvilluar) apo shitje direkt nga magazina kryesore (e mbështetur gjithashtu)?
3. **Modelet e pishinave:** listat e materialeve dhe rregullat e llogaritjes për çdo model (futen te "Modelet e pishinave").
4. **Kush miraton** daljet nga magazina dhe kthimet (magazinieri, përgjegjësi i projektit, ose të dy).
5. **Formati i ofertës:** logoja, tekstet standarde, kushtet e pagesës.
