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

FIREBASE="npx --yes firebase-tools@15"

# Në Cloud Shell, firebase-tools përdor kredencialet e gcloud. Nëse nuk mjaftojnë, kërkon hyrje me kod.
if ! $FIREBASE projects:list --non-interactive >/dev/null 2>&1; then
  echo "▶ Hyrja në Firebase: hapni lidhjen që shfaqet, zgjidhni llogarinë dhe ngjitni kodin këtu."
  $FIREBASE login --no-localhost
fi

echo "▶ Vendosja e rregullave/indekseve të Firestore dhe e Cloud Functions (disa minuta)…"
$FIREBASE deploy --only firestore,functions --project "$PROJECT" --force

echo "▶ Vendosja e rregullave të Storage…"
if ! $FIREBASE deploy --only storage --project "$PROJECT"; then
  echo "⚠ Storage nuk u vendos. Aktivizojeni te Firebase Console → Storage → Get started dhe ekzekutoni sërish skriptin."
fi

echo
echo "✔ Gati. Hapni aplikacionin dhe shtypni \"Konfigurimi fillestar\"."
