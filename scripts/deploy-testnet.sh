#!/usr/bin/env bash
# Build and deploy the BY Tickets contracts to Stellar TESTNET, wire them together,
# and write the resulting IDs into apps/web/.env.local.
#
# From the repo root: npm run contracts:deploy
# (Git Bash + Stellar CLI + Rust on the host. Does not use Docker.)
#
# Options (env vars):
#   DEPLOYER=by-deployer      Stellar CLI identity used as deployer + contract admin
#   USDC_MODE=mock|circle     mock: issue our own test USDC (default); circle: Circle's testnet USDC
#   FEE_BPS=250               platform fee (falls back to PLATFORM_FEE_BPS in .env.local)
#   ORGANIZER=G...            optionally approve this organizer right away
#
# Keys: the deployer/admin and the mock-USDC issuer are Stellar CLI identities in the
# local keystore — never in the repo or .env. Every run deploys FRESH contracts.
set -euo pipefail

NETWORK=testnet
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/apps/web/.env.local"
WASM_DIR="$ROOT/contracts/target/wasm32v1-none/release"
DEPLOYER="${DEPLOYER:-by-deployer}"
USDC_MODE="${USDC_MODE:-mock}"
CIRCLE_TESTNET_USDC_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
# 10 BY Points per 1 USDC spent; 50 BY Points per check-in (7 decimals).
PURCHASE_POINTS_PER_UNIT="${PURCHASE_POINTS_PER_UNIT:-100000000}"
ATTENDANCE_POINTS="${ATTENDANCE_POINTS:-500000000}"

log() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }

env_get() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"' || true; }

env_set() {
  local key="$1" value="$2"
  [ -f "$ENV_FILE" ] || cp "$ROOT/apps/web/.env.example" "$ENV_FILE"
  if grep -qE "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_identity() {
  local name="$1"
  if stellar keys address "$name" >/dev/null 2>&1; then
    stellar keys fund "$name" --network "$NETWORK" >/dev/null 2>&1 || true
  else
    stellar keys generate "$name" --network "$NETWORK" --fund >/dev/null
  fi
  stellar keys address "$name"
}

fund_account() {
  curl -fsS "https://friendbot.stellar.org/?addr=$1" >/dev/null 2>&1 || true
}

deploy() {
  local wasm="$1"; shift
  stellar contract deploy --wasm "$WASM_DIR/$wasm.wasm" --source "$DEPLOYER" --network "$NETWORK" --alias "by-$wasm" -- "$@" | tail -n1
}

invoke() {
  stellar contract invoke --source "$DEPLOYER" --network "$NETWORK" --id "$@"
}

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — run 'npm run secrets' first."; exit 1; }

log "Deployer identity ($DEPLOYER)"
ADMIN="$(ensure_identity "$DEPLOYER")"
echo "admin: $ADMIN"

log "Building contracts"
cd "$ROOT/contracts"
stellar contract build >/dev/null
ls -1 "$WASM_DIR"/*.wasm

log "Settlement asset (USDC, mode: $USDC_MODE)"
if [ "$USDC_MODE" = "circle" ]; then
  USDC_ISSUER="$CIRCLE_TESTNET_USDC_ISSUER"
else
  USDC_ISSUER="$(ensure_identity by-usdc-issuer)"
fi
USDC_ASSET="USDC:$USDC_ISSUER"
USDC_ID="$(stellar contract id asset --asset "$USDC_ASSET" --network "$NETWORK")"
if ! stellar contract asset deploy --asset "$USDC_ASSET" --source "$DEPLOYER" --network "$NETWORK" --alias by-usdc >/dev/null 2>&1; then
  echo "(asset contract already deployed)"
fi
echo "USDC SAC: $USDC_ID"

log "Platform treasury"
TREASURY="$(env_get NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY)"
PLATFORM_SECRET="$(env_get STELLAR_PLATFORM_SECRET)"
if [ -n "$TREASURY" ] && [ -n "$PLATFORM_SECRET" ]; then
  fund_account "$TREASURY"
  # Classic accounts need a trustline to receive USDC (the platform fee).
  stellar tx new change-trust --line "$USDC_ASSET" --source "$PLATFORM_SECRET" --network "$NETWORK" >/dev/null 2>&1 \
    || echo "(trustline already exists)"
else
  echo "No platform account in .env.local; using the deployer as treasury."
  TREASURY="$ADMIN"
  [ "$USDC_MODE" = "mock" ] && stellar tx new change-trust --line "$USDC_ASSET" --source "$DEPLOYER" --network "$NETWORK" >/dev/null 2>&1 || true
fi
echo "treasury: $TREASURY"

FEE_BPS="${FEE_BPS:-$(env_get PLATFORM_FEE_BPS)}"
FEE_BPS="${FEE_BPS:-250}"

log "Deploying rewards (BY Points)"
REWARDS_ID="$(deploy rewards --admin "$ADMIN" --name "BY Points" --symbol "BYPTS")"
echo "rewards: $REWARDS_ID"

log "Deploying attendance_badge"
BADGE_ID="$(deploy attendance_badge --admin "$ADMIN")"
echo "badge: $BADGE_ID"

log "Deploying event_ticket"
EVENT_TICKET_ID="$(deploy event_ticket \
  --admin "$ADMIN" \
  --payment_token "$USDC_ID" \
  --treasury "$TREASURY" \
  --fee_bps "$FEE_BPS" \
  --rewards "$REWARDS_ID" \
  --badge "$BADGE_ID" \
  --purchase_points_per_unit "$PURCHASE_POINTS_PER_UNIT" \
  --attendance_points "$ATTENDANCE_POINTS")"
echo "event_ticket: $EVENT_TICKET_ID"

log "Authorising event_ticket as minter of points and badges"
invoke "$REWARDS_ID" -- set_minter --minter "$EVENT_TICKET_ID" --enabled true >/dev/null
invoke "$BADGE_ID" -- set_minter --minter "$EVENT_TICKET_ID" --enabled true >/dev/null
echo "rewards.is_minter: $(invoke "$REWARDS_ID" -- is_minter --minter "$EVENT_TICKET_ID")"
echo "badge.is_minter:   $(invoke "$BADGE_ID" -- is_minter --minter "$EVENT_TICKET_ID")"

if [ -n "${ORGANIZER:-}" ]; then
  log "Approving organizer $ORGANIZER"
  invoke "$EVENT_TICKET_ID" -- approve_organizer --organizer "$ORGANIZER" >/dev/null
fi

log "Writing IDs to apps/web/.env.local"
env_set NEXT_PUBLIC_EVENT_TICKET_CONTRACT_ID "$EVENT_TICKET_ID"
env_set NEXT_PUBLIC_REWARDS_CONTRACT_ID "$REWARDS_ID"
env_set NEXT_PUBLIC_BADGE_CONTRACT_ID "$BADGE_ID"
env_set NEXT_PUBLIC_USDC_ASSET_CODE "USDC"
env_set NEXT_PUBLIC_USDC_ISSUER "$USDC_ISSUER"
env_set NEXT_PUBLIC_USDC_CONTRACT_ID "$USDC_ID"
env_set NEXT_PUBLIC_STELLAR_ADMIN_PUBLIC_KEY "$ADMIN"

mkdir -p "$ROOT/contracts/deployments"
cat > "$ROOT/contracts/deployments/testnet.json" <<JSON
{
  "network": "testnet",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "admin": "$ADMIN",
  "treasury": "$TREASURY",
  "feeBps": $FEE_BPS,
  "usdc": { "mode": "$USDC_MODE", "asset": "$USDC_ASSET", "contractId": "$USDC_ID" },
  "contracts": {
    "event_ticket": "$EVENT_TICKET_ID",
    "rewards": "$REWARDS_ID",
    "attendance_badge": "$BADGE_ID"
  },
  "wasmHashes": {
    "event_ticket": "$(sha256sum "$WASM_DIR/event_ticket.wasm" | cut -d' ' -f1)",
    "rewards": "$(sha256sum "$WASM_DIR/rewards.wasm" | cut -d' ' -f1)",
    "attendance_badge": "$(sha256sum "$WASM_DIR/attendance_badge.wasm" | cut -d' ' -f1)"
  }
}
JSON

log "Done"
echo "Explorer: https://stellar.expert/explorer/testnet/contract/$EVENT_TICKET_ID"
