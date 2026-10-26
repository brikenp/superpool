#!/usr/bin/env bash
# Vendos Cloud Functions, rregullat dhe indekset e Firestore/Storage në projektin superpool-system.
# Punon edhe nga celulari, në Google Cloud Shell (https://shell.cloud.google.com):
#
#   git clone https://github.com/brikenp/superpool && cd superpool && bash scripts/deploy-cloudshell.sh
#
# Cloud Shell është i identifikuar me llogarinë tuaj Google, prandaj nuk nevojitet çelës service account.
set -euo pipefail

PROJECT=superpool-system
cd "$(dirname "$0")/.."
git pull --ff-only -q || true

echo "▶ Projekti: $PROJECT"
gcloud config set project "$PROJECT" >/dev/null 2>&1 || true

# firebase-tools kërkon Node 20+; Cloud Shell ka nvm.
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "▶ Instalimi i Node 22…"
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" && nvm install 22 >/dev/null && nvm use 22 >/dev/null
fi

echo "▶ Instalimi i varësive të funksioneve…"
npm --prefix functions ci --no-audit --no-fund --loglevel=error

# Në organizatat Google Workspace, llogaria e paracaktuar e Compute nuk merr automatikisht rolin Editor.
# Funksionet ndërtohen dhe ekzekutohen me të, prandaj i japim vetëm rolet që i nevojiten.
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
RUNTIME_SA="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "▶ Rolet e llogarisë së funksioneve…"
for R in roles/cloudbuild.builds.builder roles/logging.logWriter roles/artifactregistry.writer roles/storage.objectAdmin \
         roles/datastore.user roles/firebaseauth.admin roles/eventarc.eventReceiver roles/run.invoker; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="$RUNTIME_SA" --role="$R" --condition=None -q >/dev/null 2>&1 \
    && echo "  OK $R" || echo "  ⚠ $R nuk u vendos (nevojitet roli Owner)"
done
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountTokenCreator --condition=None -q >/dev/null 2>&1 || true

FIREBASE="npx --yes firebase-tools@15"

# Në Cloud Shell, firebase-tools përdor kredencialet e gcloud. Nëse nuk mjaftojnë, kërkon hyrje me kod.
if ! $FIREBASE projects:list --non-interactive >/dev/null 2>&1; then
  echo "▶ Hyrja në Firebase: hapni lidhjen që shfaqet, zgjidhni llogarinë dhe ngjitni kodin këtu."
  $FIREBASE login --no-localhost
fi

echo "▶ Vendosja e rregullave/indekseve të Firestore…"
$FIREBASE deploy --only firestore --project "$PROJECT" --force

# Google kufizon sa funksione përditësohen njëherësh (kuota për minutë). Prandaj: një deploy i plotë,
# pastaj funksionet që dështuan vendosen me grupe të vogla (3 nga 3), me pushim mes grupeve.
failed_from() {
  # Emrat nga "…following functions: emri(europe-west1)" dhe "Failed to … function projects/…/functions/emri".
  { grep -oE '^[[:space:]]+[A-Za-z][A-Za-z0-9_]*\(europe-west1\)' "$1" | tr -d ' \t' | sed 's/(.*//';
    grep -oE "Failed to (update|create) function [^ ]+" "$1" | awk '{print $NF}' | sed 's#.*/##'; } \
    | grep -E '^[A-Za-z][A-Za-z0-9_]*$' | grep -v '^projects$' | sort -u || true
}
deploy_only() { # $1 = lista "functions:a,functions:b"; kthen 0 nëse s'ka dështime
  $FIREBASE deploy --only "$1" --project "$PROJECT" --force 2>&1 | tee "$LOG" || true
  ! grep -q "Failed to update function\|Failed to create function\|There was an error deploying" "$LOG"
}

echo "▶ Vendosja e Cloud Functions (disa minuta)…"
LOG=$(mktemp)
if ! deploy_only functions; then
  PENDING=$(failed_from "$LOG")
  if [ -z "$PENDING" ]; then echo "⚠ Deploy-i dështoi për një arsye tjetër — shihni mesazhet më sipër."; exit 1; fi
  LEFT=""
  for BATCH in $(echo "$PENDING" | paste -d, - - - | sed 's/,,*$//'); do
    ONLY=$(echo "$BATCH" | tr ',' '\n' | grep . | sed 's/^/functions:/' | paste -sd, -)
    for TRY in 1 2 3; do
      echo "↻ Pres 60 sekonda (kufiri i Google) dhe vendos: $ONLY (prova $TRY)"
      sleep 60
      if deploy_only "$ONLY"; then ONLY=""; break; fi
      F=$(failed_from "$LOG")
      [ -z "$F" ] && break
      ONLY=$(echo "$F" | sed 's/^/functions:/' | paste -sd, -)
    done
    [ -n "$ONLY" ] && LEFT="$LEFT $ONLY"
  done
  if [ -n "$LEFT" ]; then
    echo "⚠ Këto funksione nuk u vendosën:$LEFT"
    echo "  Prisni 5 minuta dhe ekzekutoni sërish skriptin (funksionet e tjera janë gati)."
    exit 1
  fi
fi
rm -f "$LOG"

# Funksionet onCall duhet të jenë të thirrshme nga shfletuesi (kontrolli i identitetit bëhet brenda kodit).
# Në projektet me organizatë Google Workspace, deploy-i nuk arrin ta vendosë vetë këtë leje.
echo "▶ Leja e thirrjes për funksionet onCall…"
for F in $(grep -oE '^export \{[^}]+\}' functions/src/index.js | tr -d '{},' | tr ' ' '\n' | grep -vE '^(export|from|on[A-Z].*|auditWrites)?$'); do
  gcloud functions add-invoker-policy-binding "$F" --region=europe-west1 --member=allUsers -q >/dev/null 2>&1 \
    && echo "  OK $F" || echo "  ⚠ $F: leja nuk u vendos (kontrolloni politikën iam.allowedPolicyMemberDomains)"
done

echo "▶ Vendosja e rregullave të Storage…"
if ! $FIREBASE deploy --only storage --project "$PROJECT"; then
  echo "⚠ Storage nuk u vendos. Aktivizojeni te Firebase Console → Storage → Get started dhe ekzekutoni sërish skriptin."
fi

echo
echo "✔ Gati. Hapni aplikacionin dhe shtypni \"Konfigurimi fillestar\"."
