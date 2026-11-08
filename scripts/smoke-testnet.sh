#!/usr/bin/env bash
# End-to-end smoke test against the contracts in contracts/deployments/testnet.json:
# approve organizer -> create event -> buy ticket (fee to treasury, net escrowed) -> complete
# + release payout -> check in -> replay rejected -> points + badge awarded.
# Uses throwaway `by-smoke-*` identities. Requires event_ticket v2 on testnet.
#
#   npm run contracts:smoke
set -euo pipefail

NETWORK=testnet
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENTS="$ROOT/contracts/deployments/testnet.json"
DEPLOYER="${DEPLOYER:-by-deployer}"

TIX=$(jq -r .contracts.event_ticket "$DEPLOYMENTS")
POINTS=$(jq -r .contracts.rewards "$DEPLOYMENTS")
BADGE=$(jq -r .contracts.attendance_badge "$DEPLOYMENTS")
USDC=$(jq -r .usdc.contractId "$DEPLOYMENTS")
USDC_ASSET=$(jq -r .usdc.asset "$DEPLOYMENTS")
TREASURY=$(jq -r .treasury "$DEPLOYMENTS")

log() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
pass() { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✘ %s\033[0m\n' "$*"; exit 1; }

identity() {
  stellar keys address "$1" >/dev/null 2>&1 || stellar keys generate "$1" --network "$NETWORK" --fund >/dev/null
  stellar keys address "$1"
}
trust() { stellar tx new change-trust --line "$USDC_ASSET" --source "$1" --network "$NETWORK" >/dev/null 2>&1 || true; }
call() { local src="$1" id="$2"; shift 2; stellar contract invoke --source "$src" --network "$NETWORK" --id "$id" -- "$@" 2>/dev/null; }
view() { local id="$1"; shift; stellar contract invoke --source "$DEPLOYER" --network "$NETWORK" --id "$id" --send=no -- "$@" 2>/dev/null; }
unquote() { tr -d '"'; }

log "Identities"
ORG=$(identity by-smoke-organizer)
ARTIST=$(identity by-smoke-artist)
BUYER=$(identity by-smoke-buyer)
SCANNER=$(identity by-smoke-scanner)
for who in by-smoke-organizer by-smoke-artist by-smoke-buyer; do trust "$who"; done
echo "organizer $ORG"; echo "artist    $ARTIST"; echo "buyer     $BUYER"; echo "scanner   $SCANNER"

log "Fund buyer with 150 test USDC"
call by-usdc-issuer "$USDC" mint --to "$BUYER" --amount 1500000000 >/dev/null

T0=$(view "$USDC" balance --id "$TREASURY" | unquote)
O0=$(view "$USDC" balance --id "$ORG" | unquote)
A0=$(view "$USDC" balance --id "$ARTIST" | unquote)
P0=$(view "$POINTS" balance --id "$BUYER" | unquote)

log "Approve organizer + create event (100 USDC, 70/30 split)"
call "$DEPLOYER" "$TIX" approve_organizer --organizer "$ORG" >/dev/null
EVENT_ID=$(call by-smoke-organizer "$TIX" create_event \
  --organizer "$ORG" --capacity 100 --price 1000000000 --max_transfers 1 --resale_cap 1200000000 \
  --splits "[{\"recipient\":\"$ORG\",\"bps\":7000},{\"recipient\":\"$ARTIST\",\"bps\":3000}]" \
  --metadata_hash "$(printf 'by-smoke-%s' "$(date +%s)" | sha256sum | cut -d' ' -f1)" \
  --ends_at 0 --royalty_bps 0 | unquote)
echo "event_id: $EVENT_ID"
call by-smoke-organizer "$TIX" set_scanner --event_id "$EVENT_ID" --scanner "$SCANNER" --enabled true >/dev/null

log "Buy ticket"
TICKET_ID=$(call by-smoke-buyer "$TIX" mint_ticket --payer "$BUYER" --owner "$BUYER" --event_id "$EVENT_ID" --tier 0 | unquote)
echo "ticket_id: $TICKET_ID"

dT=$(( $(view "$USDC" balance --id "$TREASURY" | unquote) - T0 ))
dO=$(( $(view "$USDC" balance --id "$ORG" | unquote) - O0 ))
dA=$(( $(view "$USDC" balance --id "$ARTIST" | unquote) - A0 ))
ESCROW=$(view "$TIX" escrow_balance --event_id "$EVENT_ID" | unquote)
[ "$dT" = 25000000 ] && pass "platform fee 2.5 USDC" || fail "platform fee: $dT"
[ "$dO" = 0 ] && pass "organizer unpaid until release" || fail "organizer before release: $dO"
[ "$dA" = 0 ] && pass "artist unpaid until release" || fail "artist before release: $dA"
[ "$ESCROW" = 975000000 ] && pass "escrow 97.5 USDC" || fail "escrow: $ESCROW"

log "Complete event and release escrow"
call by-smoke-organizer "$TIX" complete_event --caller "$ORG" --event_id "$EVENT_ID" >/dev/null
call by-smoke-organizer "$TIX" release_payout --caller "$ORG" --event_id "$EVENT_ID" >/dev/null
dO=$(( $(view "$USDC" balance --id "$ORG" | unquote) - O0 ))
dA=$(( $(view "$USDC" balance --id "$ARTIST" | unquote) - A0 ))
[ "$dO" = 682500000 ] && pass "organizer 68.25 USDC after release" || fail "organizer: $dO"
[ "$dA" = 292500000 ] && pass "artist 29.25 USDC after release" || fail "artist: $dA"

log "Check in at the door"
BADGE_ID=$(call by-smoke-scanner "$TIX" validate_and_check_in --ticket_id "$TICKET_ID" --scanner "$SCANNER" | unquote)
pass "checked in, badge #$BADGE_ID"

if call by-smoke-scanner "$TIX" validate_and_check_in --ticket_id "$TICKET_ID" --scanner "$SCANNER" >/dev/null; then
  fail "replayed check-in was accepted"
else
  pass "replayed check-in rejected"
fi

# 100 USDC x 10 points + 50 attendance = 1050 BY Points (7 decimals).
dP=$(( $(view "$POINTS" balance --id "$BUYER" | unquote) - P0 ))
[ "$dP" = 10500000000 ] && pass "buyer earned 1050 BY Points" || fail "points delta: $dP"

[ "$(view "$BADGE" has_badge --event_id "$EVENT_ID" --attendee "$BUYER")" = "true" ] && pass "attendance badge minted" || fail "no badge"
[ "$(view "$TIX" get_ticket --ticket_id "$TICKET_ID" | jq -r .checked_in)" = "true" ] && pass "ticket marked used" || fail "ticket not used"

log "Smoke test passed"
