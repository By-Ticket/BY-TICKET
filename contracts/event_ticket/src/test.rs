extern crate std;

use super::*;
use attendance_badge::{AttendanceBadge, AttendanceBadgeClient};
use rewards::{Rewards, RewardsClient};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{vec, String};

/// 1.0000000 of a 7-decimal token.
const UNIT: i128 = 10_000_000;
const FEE_BPS: u32 = 250; // 2.5%
const PURCHASE_POINTS_PER_UNIT: i128 = 10 * UNIT; // 10 points per USDC
const ATTENDANCE_POINTS: i128 = 50 * UNIT;

struct World<'a> {
    env: Env,
    admin: Address,
    treasury: Address,
    organizer: Address,
    artist: Address,
    usdc: TokenClient<'a>,
    usdc_admin: StellarAssetClient<'a>,
    points: RewardsClient<'a>,
    badges: AttendanceBadgeClient<'a>,
    tix: EventTicketClient<'a>,
}

fn world<'a>() -> World<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_760_000_000);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let organizer = Address::generate(&env);
    let artist = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc = TokenClient::new(&env, &sac.address());
    let usdc_admin = StellarAssetClient::new(&env, &sac.address());

    let points_id =
        env.register(Rewards, (&admin, String::from_str(&env, "BY Points"), String::from_str(&env, "BYPTS")));
    let badge_id = env.register(AttendanceBadge, (&admin,));
    let tix_id = env.register(
        EventTicket,
        (
            &admin,
            &sac.address(),
            &treasury,
            FEE_BPS,
            &points_id,
            &badge_id,
            PURCHASE_POINTS_PER_UNIT,
            ATTENDANCE_POINTS,
        ),
    );

    let points = RewardsClient::new(&env, &points_id);
    let badges = AttendanceBadgeClient::new(&env, &badge_id);
    let tix = EventTicketClient::new(&env, &tix_id);
    points.set_minter(&tix_id, &true);
    badges.set_minter(&tix_id, &true);
    tix.approve_organizer(&organizer);

    World { env, admin, treasury, organizer, artist, usdc, usdc_admin, points, badges, tix }
}

impl World<'_> {
    fn hash(&self) -> BytesN<32> {
        BytesN::from_array(&self.env, &[7u8; 32])
    }

    /// 70% organizer / 30% artist of post-fee proceeds.
    fn splits(&self) -> Vec<Split> {
        vec![
            &self.env,
            Split { recipient: self.organizer.clone(), bps: 7_000 },
            Split { recipient: self.artist.clone(), bps: 3_000 },
        ]
    }

    fn event(&self, capacity: u32, price: i128, max_transfers: u32, resale_cap: i128) -> u64 {
        self.event_with(capacity, price, max_transfers, resale_cap, 0, 0)
    }

    fn event_with(
        &self,
        capacity: u32,
        price: i128,
        max_transfers: u32,
        resale_cap: i128,
        ends_at: u64,
        royalty_bps: u32,
    ) -> u64 {
        self.tix.create_event(
            &self.organizer,
            &capacity,
            &price,
            &max_transfers,
            &resale_cap,
            &self.splits(),
            &self.hash(),
            &ends_at,
            &royalty_bps,
        )
    }

    fn funded_user(&self, usdc: i128) -> Address {
        let user = Address::generate(&self.env);
        if usdc > 0 {
            self.usdc_admin.mint(&user, &usdc);
        }
        user
    }

    fn buy(&self, buyer: &Address, event_id: u64) -> u64 {
        self.tix.mint_ticket(buyer, buyer, &event_id, &0)
    }
}

fn emitted(env: &Env, contract: &Address, name: &str) -> bool {
    use soroban_sdk::xdr::{ContractEventBody, ScSymbol, ScVal};
    let want = ScVal::Symbol(ScSymbol(name.try_into().unwrap()));
    env.events().all().filter_by_contract(contract).events().iter().any(|e| {
        let ContractEventBody::V0(body) = &e.body;
        body.topics.first() == Some(&want)
    })
}

// ---- events & roles -----------------------------------------------------------------

#[test]
fn creates_event_with_default_tier() {
    let w = world();
    let id = w.event(100, 50 * UNIT, 1, 60 * UNIT);
    assert!(emitted(&w.env, &w.tix.address, "event_created"));
    assert_eq!(w.env.auths()[0].0, w.organizer);

    let e = w.tix.get_event(&id);
    assert_eq!(e.organizer, w.organizer);
    assert_eq!(e.capacity, 100);
    assert_eq!(e.fee_bps, FEE_BPS);
    assert_eq!(e.royalty_bps, 0);
    assert_eq!(e.status, EventStatus::Live);
    assert_eq!(e.tiers.len(), 1);
    assert_eq!(e.tiers.get(0).unwrap(), Tier { price: 50 * UNIT, capacity: 100, sold: 0 });
    assert!(e.sales_open);
    assert_eq!(w.tix.escrow_balance(&id), 0);
    assert_eq!(w.tix.event_status(&id), EventStatus::Live);
}

#[test]
fn unapproved_organizer_cannot_create_events() {
    let w = world();
    let stranger = Address::generate(&w.env);
    let res = w.tix.try_create_event(&stranger, &10, &UNIT, &0, &0, &w.splits(), &w.hash(), &0u64, &0u32);
    assert_eq!(res, Err(Ok(Error::NotOrganizer)));

    w.tix.revoke_organizer(&w.organizer);
    let res = w.tix.try_create_event(&w.organizer, &10, &UNIT, &0, &0, &w.splits(), &w.hash(), &0u64, &0u32);
    assert_eq!(res, Err(Ok(Error::NotOrganizer)));
}

#[test]
fn rejects_bad_event_parameters() {
    let w = world();
    let bad_sum = vec![&w.env, Split { recipient: w.organizer.clone(), bps: 9_000 }];
    let zero_share = vec![
        &w.env,
        Split { recipient: w.organizer.clone(), bps: 10_000 },
        Split { recipient: w.artist.clone(), bps: 0 },
    ];
    let empty: Vec<Split> = Vec::new(&w.env);
    for splits in [bad_sum, zero_share, empty] {
        assert_eq!(
            w.tix.try_create_event(&w.organizer, &10, &UNIT, &0, &0, &splits, &w.hash(), &0u64, &0u32),
            Err(Ok(Error::InvalidSplits))
        );
    }
    assert_eq!(
        w.tix.try_create_event(&w.organizer, &0, &UNIT, &0, &0, &w.splits(), &w.hash(), &0u64, &0u32),
        Err(Ok(Error::InvalidCapacity))
    );
    assert_eq!(
        w.tix.try_create_event(&w.organizer, &10, &-1, &0, &0, &w.splits(), &w.hash(), &0u64, &0u32),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        w.tix.try_create_event(&w.organizer, &10, &UNIT, &0, &0, &w.splits(), &w.hash(), &0u64, &(MAX_ROYALTY_BPS + 1)),
        Err(Ok(Error::RoyaltyTooHigh))
    );
}

#[test]
fn only_admin_sets_fees_and_fee_is_capped() {
    let w = world();
    w.tix.set_fee(&500, &w.treasury);
    assert_eq!(w.env.auths()[0].0, w.admin);
    assert_eq!(w.tix.config().fee_bps, 500);
    assert_eq!(w.tix.try_set_fee(&(MAX_FEE_BPS + 1), &w.treasury), Err(Ok(Error::FeeTooHigh)));
}

#[test]
#[should_panic]
fn constructor_rejects_excessive_fee() {
    let env = Env::default();
    let a = Address::generate(&env);
    env.register(EventTicket, (&a, &a, &a, MAX_FEE_BPS + 1, &a, &a, 0i128, 0i128));
}

// ---- purchase, revenue split, points ------------------------------------------------

#[test]
fn purchase_splits_revenue_and_awards_points() {
    let w = world();
    let id = w.event(100, 100 * UNIT, 1, 100 * UNIT);
    let buyer = w.funded_user(150 * UNIT);

    let ticket_id = w.buy(&buyer, id);
    assert!(emitted(&w.env, &w.tix.address, "ticket_minted"));
    assert!(emitted(&w.env, &w.tix.address, "escrowed"));

    // 100 USDC: 2.5 fee to treasury immediately; 97.5 net stays in contract escrow.
    let net = UNIT * 975 / 10;
    assert_eq!(w.usdc.balance(&buyer), 50 * UNIT);
    assert_eq!(w.usdc.balance(&w.treasury), UNIT * 25 / 10);
    assert_eq!(w.usdc.balance(&w.organizer), 0);
    assert_eq!(w.usdc.balance(&w.artist), 0);
    assert_eq!(w.usdc.balance(&w.tix.address), net);
    assert_eq!(w.tix.escrow_balance(&id), net);
    assert_eq!(w.tix.event_status(&id), EventStatus::Live);

    // 10 points per USDC.
    assert_eq!(w.points.balance(&buyer), 1_000 * UNIT);

    let t = w.tix.get_ticket(&ticket_id);
    assert_eq!(t.owner, buyer);
    assert_eq!(t.event_id, id);
    assert!(!t.checked_in);
    assert_eq!(t.paid, net);
    assert!(!t.refunded);
    assert_eq!(w.tix.get_event(&id).sold, 1);
}

#[test]
fn split_rounding_dust_goes_to_last_recipient() {
    let w = world();
    // 3 units at 2.5% fee -> fee 0 (truncated), dust lands on the artist.
    let id = w.event(10, 3, 0, 0);
    let (fee, parts) = w.tix.quote_split(&id, &3);
    assert_eq!(fee, 0);
    assert_eq!(parts, vec![&w.env, 2i128, 1i128]);
    assert_eq!(fee + parts.iter().sum::<i128>(), 3);

    let buyer = w.funded_user(3);
    w.buy(&buyer, id);
    assert_eq!(w.usdc.balance(&w.tix.address), 3);
    w.tix.complete_event(&w.organizer, &id);
    w.tix.release_payout(&w.organizer, &id);
    assert_eq!(w.usdc.balance(&w.organizer) + w.usdc.balance(&w.artist) + w.usdc.balance(&w.treasury), 3);
    assert_eq!(w.usdc.balance(&w.organizer), 2);
    assert_eq!(w.usdc.balance(&w.artist), 1);
}

#[test]
fn fee_is_snapshotted_per_event() {
    let w = world();
    let id = w.event(10, 100 * UNIT, 0, 0);
    w.tix.set_fee(&1_000, &w.treasury);
    let buyer = w.funded_user(100 * UNIT);
    w.buy(&buyer, id);
    assert_eq!(w.usdc.balance(&w.treasury), UNIT * 25 / 10); // still 2.5%
}

#[test]
fn payer_can_buy_for_someone_else() {
    let w = world();
    let id = w.event(10, 10 * UNIT, 0, 0);
    let platform = w.funded_user(10 * UNIT);
    let fan = Address::generate(&w.env);

    let ticket_id = w.tix.mint_ticket(&platform, &fan, &id, &0);
    assert_eq!(w.env.auths()[0].0, platform);
    assert_eq!(w.tix.get_ticket(&ticket_id).owner, fan);
    assert_eq!(w.points.balance(&fan), 100 * UNIT);
    assert_eq!(w.points.balance(&platform), 0);
}

#[test]
fn free_event_needs_no_funds() {
    let w = world();
    let id = w.event(5, 0, 0, 0);
    let fan = w.funded_user(0);
    let ticket_id = w.buy(&fan, id);
    assert_eq!(w.tix.get_ticket(&ticket_id).owner, fan);
    assert_eq!(w.points.balance(&fan), 0);
}

#[test]
fn insufficient_funds_reverts_purchase() {
    let w = world();
    let id = w.event(5, 10 * UNIT, 0, 0);
    let broke = w.funded_user(UNIT);
    assert!(w.tix.try_mint_ticket(&broke, &broke, &id, &0).is_err());
    assert_eq!(w.tix.get_event(&id).sold, 0);
    assert_eq!(w.usdc.balance(&broke), UNIT);
}

// ---- capacity & tiers ----------------------------------------------------------------

#[test]
fn never_oversells() {
    let w = world();
    let id = w.event(2, UNIT, 0, 0);
    let buyer = w.funded_user(10 * UNIT);
    w.buy(&buyer, id);
    w.buy(&buyer, id);
    assert_eq!(w.tix.try_mint_ticket(&buyer, &buyer, &id, &0), Err(Ok(Error::SoldOut)));
    assert_eq!(w.tix.get_event(&id).sold, 2);
    assert_eq!(w.usdc.balance(&buyer), 8 * UNIT);
}

#[test]
fn tiers_have_own_price_and_capacity_within_event_cap() {
    let w = world();
    let id = w.event(3, 10 * UNIT, 0, 0);
    let vip = w.tix.add_tier(&id, &(50 * UNIT), &1);
    assert_eq!(vip, 1);
    assert!(emitted(&w.env, &w.tix.address, "tier_added"));

    let buyer = w.funded_user(200 * UNIT);
    w.tix.mint_ticket(&buyer, &buyer, &id, &vip);
    assert_eq!(w.usdc.balance(&buyer), 150 * UNIT);
    assert_eq!(w.tix.try_mint_ticket(&buyer, &buyer, &id, &vip), Err(Ok(Error::TierSoldOut)));

    w.buy(&buyer, id);
    w.buy(&buyer, id);
    // Event-wide cap of 3 reached even though the GA tier has room.
    assert_eq!(w.tix.try_mint_ticket(&buyer, &buyer, &id, &0), Err(Ok(Error::SoldOut)));
    assert_eq!(w.tix.try_mint_ticket(&buyer, &buyer, &id, &9), Err(Ok(Error::SoldOut)));
}

#[test]
fn tier_validation() {
    let w = world();
    let id = w.event(10, UNIT, 0, 0);
    assert_eq!(w.tix.try_add_tier(&id, &UNIT, &11), Err(Ok(Error::InvalidCapacity)));
    assert_eq!(w.tix.try_add_tier(&id, &-UNIT, &1), Err(Ok(Error::InvalidAmount)));
    for _ in 1..MAX_TIERS {
        w.tix.add_tier(&id, &UNIT, &1);
    }
    assert_eq!(w.tix.try_add_tier(&id, &UNIT, &1), Err(Ok(Error::TooManyTiers)));
    let buyer = w.funded_user(UNIT);
    assert_eq!(w.tix.try_mint_ticket(&buyer, &buyer, &id, &MAX_TIERS), Err(Ok(Error::TierNotFound)));
}

#[test]
fn organizer_can_close_sales_and_resize() {
    let w = world();
    let id = w.event(2, UNIT, 0, 0);
    let buyer = w.funded_user(10 * UNIT);
    w.buy(&buyer, id);

    w.tix.update_event(&id, &2, &0, &0, &false);
    assert_eq!(w.env.auths()[0].0, w.organizer);
    assert_eq!(w.tix.try_mint_ticket(&buyer, &buyer, &id, &0), Err(Ok(Error::SalesClosed)));

    assert_eq!(w.tix.try_update_event(&id, &0, &0, &0, &true), Err(Ok(Error::InvalidCapacity)));
    w.tix.update_event(&id, &1, &0, &0, &true); // == sold is allowed
    assert_eq!(w.tix.try_mint_ticket(&buyer, &buyer, &id, &0), Err(Ok(Error::SoldOut)));
}

#[test]
fn unknown_event_and_ticket() {
    let w = world();
    let buyer = w.funded_user(UNIT);
    assert_eq!(w.tix.try_mint_ticket(&buyer, &buyer, &42, &0), Err(Ok(Error::EventNotFound)));
    assert_eq!(w.tix.try_get_ticket(&42), Err(Ok(Error::TicketNotFound)));
}

// ---- transfers ---------------------------------------------------------------------

#[test]
fn gift_transfer_moves_ownership() {
    let w = world();
    let id = w.event(10, UNIT, 1, 0);
    let alice = w.funded_user(UNIT);
    let bob = Address::generate(&w.env);
    let t = w.buy(&alice, id);

    w.tix.transfer_ticket(&t, &alice, &bob, &0);
    assert!(emitted(&w.env, &w.tix.address, "ticket_transferred"));
    assert_eq!(w.env.auths()[0].0, alice);
    let ticket = w.tix.get_ticket(&t);
    assert_eq!(ticket.owner, bob);
    assert_eq!(ticket.transfers, 1);
}

#[test]
fn transfer_limit_is_enforced() {
    let w = world();
    let id = w.event(10, UNIT, 1, 0);
    let alice = w.funded_user(UNIT);
    let bob = Address::generate(&w.env);
    let carol = Address::generate(&w.env);
    let t = w.buy(&alice, id);
    w.tix.transfer_ticket(&t, &alice, &bob, &0);
    assert_eq!(w.tix.try_transfer_ticket(&t, &bob, &carol, &0), Err(Ok(Error::TransferLimitReached)));
}

#[test]
fn non_transferable_event() {
    let w = world();
    let id = w.event(10, UNIT, 0, 0);
    let alice = w.funded_user(UNIT);
    let bob = Address::generate(&w.env);
    let t = w.buy(&alice, id);
    assert_eq!(w.tix.try_transfer_ticket(&t, &alice, &bob, &0), Err(Ok(Error::TransferLimitReached)));
}

#[test]
fn resale_cap_is_enforced_and_payment_is_atomic() {
    let w = world();
    let id = w.event(10, 20 * UNIT, 2, 25 * UNIT);
    let alice = w.funded_user(20 * UNIT);
    let bob = w.funded_user(100 * UNIT);
    let t = w.buy(&alice, id);

    assert_eq!(w.tix.try_transfer_ticket(&t, &alice, &bob, &(26 * UNIT)), Err(Ok(Error::ResaleCapExceeded)));

    w.tix.transfer_ticket(&t, &alice, &bob, &(25 * UNIT));
    // Priced resale requires the buyer's signature too.
    let signers: std::vec::Vec<Address> = w.env.auths().into_iter().map(|(a, _)| a).collect();
    assert!(signers.contains(&alice) && signers.contains(&bob));
    // 25 USDC resale, 2.5% fee, 0% royalty: seller gets 24.375, treasury +0.625.
    let resale_fee = 25 * UNIT * FEE_BPS as i128 / 10_000;
    assert_eq!(w.usdc.balance(&alice), 25 * UNIT - resale_fee);
    assert_eq!(w.usdc.balance(&bob), 75 * UNIT);
    assert_eq!(w.tix.get_ticket(&t).owner, bob);
}

#[test]
fn only_owner_can_transfer() {
    let w = world();
    let id = w.event(10, UNIT, 3, 0);
    let alice = w.funded_user(UNIT);
    let mallory = Address::generate(&w.env);
    let t = w.buy(&alice, id);
    assert_eq!(w.tix.try_transfer_ticket(&t, &mallory, &mallory, &0), Err(Ok(Error::NotOwner)));
    assert_eq!(w.tix.try_transfer_ticket(&t, &alice, &alice, &0), Err(Ok(Error::InvalidRecipient)));
}

// ---- check-in ----------------------------------------------------------------------

#[test]
fn check_in_marks_used_awards_points_and_badge() {
    let w = world();
    let id = w.event(10, 10 * UNIT, 1, 0);
    let fan = w.funded_user(10 * UNIT);
    let scanner = Address::generate(&w.env);
    let t = w.buy(&fan, id);
    w.tix.set_scanner(&id, &scanner, &true);
    assert!(w.tix.is_scanner(&id, &scanner));

    w.env.ledger().set_timestamp(1_760_100_000);
    let badge_id = w.tix.validate_and_check_in(&t, &scanner);
    assert!(emitted(&w.env, &w.tix.address, "checked_in"));
    assert_eq!(w.env.auths()[0].0, scanner);

    let ticket = w.tix.get_ticket(&t);
    assert!(ticket.checked_in);
    assert_eq!(ticket.checked_in_at, 1_760_100_000);
    assert_eq!(w.tix.get_event(&id).checked_in, 1);
    // 100 purchase points + 50 attendance points.
    assert_eq!(w.points.balance(&fan), 150 * UNIT);
    assert!(w.badges.has_badge(&id, &fan));
    assert_eq!(w.badges.badge(&badge_id).owner, fan);
}

#[test]
fn double_check_in_is_rejected() {
    let w = world();
    let id = w.event(10, UNIT, 1, 0);
    let fan = w.funded_user(UNIT);
    let t = w.buy(&fan, id);
    w.tix.validate_and_check_in(&t, &w.organizer);
    assert_eq!(w.tix.try_validate_and_check_in(&t, &w.organizer), Err(Ok(Error::AlreadyCheckedIn)));
    assert_eq!(w.tix.get_event(&id).checked_in, 1);
    assert_eq!(w.points.balance(&fan), 60 * UNIT);
}

#[test]
fn used_ticket_cannot_be_transferred() {
    let w = world();
    let id = w.event(10, UNIT, 5, 0);
    let fan = w.funded_user(UNIT);
    let friend = Address::generate(&w.env);
    let t = w.buy(&fan, id);
    w.tix.validate_and_check_in(&t, &w.organizer);
    assert_eq!(w.tix.try_transfer_ticket(&t, &fan, &friend, &0), Err(Ok(Error::AlreadyCheckedIn)));
}

#[test]
fn scanners_are_scoped_per_event() {
    let w = world();
    let a = w.event(10, UNIT, 0, 0);
    let b = w.event(10, UNIT, 0, 0);
    let fan = w.funded_user(2 * UNIT);
    let scanner = Address::generate(&w.env);
    let ticket_b = w.buy(&fan, b);
    w.tix.set_scanner(&a, &scanner, &true);

    assert_eq!(w.tix.try_validate_and_check_in(&ticket_b, &scanner), Err(Ok(Error::NotScanner)));

    w.tix.set_scanner(&b, &scanner, &true);
    w.tix.set_scanner(&b, &scanner, &false);
    assert_eq!(w.tix.try_validate_and_check_in(&ticket_b, &scanner), Err(Ok(Error::NotScanner)));
}

#[test]
fn one_badge_per_attendee_even_with_two_tickets() {
    let w = world();
    let id = w.event(10, 0, 0, 0);
    let fan = w.funded_user(0);
    let t1 = w.buy(&fan, id);
    let t2 = w.buy(&fan, id);
    let b1 = w.tix.validate_and_check_in(&t1, &w.organizer);
    let b2 = w.tix.validate_and_check_in(&t2, &w.organizer);
    assert_eq!(b1, b2);
    assert_eq!(w.badges.badges_of(&fan).len(), 1);
    assert_eq!(w.tix.get_event(&id).checked_in, 2);
}

// ---- pause ---------------------------------------------------------------------------

#[test]
fn pause_blocks_sales_and_transfers_but_not_doors() {
    let w = world();
    let id = w.event(10, UNIT, 1, 0);
    let fan = w.funded_user(2 * UNIT);
    let friend = Address::generate(&w.env);
    let t = w.buy(&fan, id);

    w.tix.set_paused(&true);
    assert!(w.tix.paused());
    assert_eq!(w.tix.try_mint_ticket(&fan, &fan, &id, &0), Err(Ok(Error::Paused)));
    assert_eq!(w.tix.try_transfer_ticket(&t, &fan, &friend, &0), Err(Ok(Error::Paused)));
    w.tix.validate_and_check_in(&t, &w.organizer);

    w.tix.set_paused(&false);
    w.buy(&fan, id);
}

#[test]
#[should_panic]
fn pause_requires_admin_auth() {
    let w = world();
    w.env.mock_auths(&[]);
    w.tix.set_paused(&true);
}

#[test]
#[should_panic]
fn check_in_requires_scanner_signature() {
    let w = world();
    let id = w.event(10, 0, 0, 0);
    let fan = w.funded_user(0);
    let t = w.buy(&fan, id);
    w.env.mock_auths(&[]);
    w.tix.validate_and_check_in(&t, &w.organizer);
}

// ---- escrow, completion, refunds, royalties ----------------------------------------

#[test]
fn release_is_blocked_before_completion() {
    let w = world();
    let id = w.event(10, 100 * UNIT, 0, 0);
    let buyer = w.funded_user(100 * UNIT);
    w.buy(&buyer, id);

    assert_eq!(w.tix.try_release_payout(&w.organizer, &id), Err(Ok(Error::EventNotCompleted)));
    assert_eq!(w.usdc.balance(&w.organizer), 0);
    assert_eq!(w.tix.escrow_balance(&id), UNIT * 975 / 10);
}

#[test]
fn complete_event_is_blocked_before_ends_at() {
    let w = world();
    let ends = w.env.ledger().timestamp() + 3_600;
    let id = w.event_with(10, UNIT, 0, 0, ends, 0);
    assert_eq!(w.tix.try_complete_event(&w.organizer, &id), Err(Ok(Error::TooEarly)));

    w.env.ledger().set_timestamp(ends);
    w.tix.complete_event(&w.organizer, &id);
    assert_eq!(w.tix.event_status(&id), EventStatus::Completed);
    assert!(!w.tix.get_event(&id).sales_open);
}

#[test]
fn release_after_completion_pays_splits() {
    let w = world();
    let id = w.event(10, 100 * UNIT, 0, 0);
    let buyer = w.funded_user(100 * UNIT);
    w.buy(&buyer, id);

    w.tix.complete_event(&w.organizer, &id);
    assert_eq!(w.env.auths()[0].0, w.organizer);
    let paid = w.tix.release_payout(&w.organizer, &id);
    assert!(emitted(&w.env, &w.tix.address, "released"));
    assert_eq!(paid, UNIT * 975 / 10);
    assert_eq!(w.usdc.balance(&w.organizer), UNIT * 6_825 / 100);
    assert_eq!(w.usdc.balance(&w.artist), UNIT * 2_925 / 100);
    assert_eq!(w.tix.escrow_balance(&id), 0);
    assert_eq!(w.usdc.balance(&w.tix.address), 0);
    assert!(w.tix.get_event(&id).payout_released);
    assert_eq!(w.tix.try_release_payout(&w.organizer, &id), Err(Ok(Error::AlreadyReleased)));
}

#[test]
fn admin_can_complete_and_release() {
    let w = world();
    let id = w.event(10, 100 * UNIT, 0, 0);
    let buyer = w.funded_user(100 * UNIT);
    w.buy(&buyer, id);
    w.tix.complete_event(&w.admin, &id);
    w.tix.release_payout(&w.admin, &id);
    assert_eq!(w.usdc.balance(&w.organizer), UNIT * 6_825 / 100);
}

#[test]
fn partial_release_after_check_in_milestone() {
    let w = world();
    let id = w.event(10, 100 * UNIT, 0, 0);
    let buyer = w.funded_user(100 * UNIT);
    let ticket_id = w.buy(&buyer, id);
    w.tix.set_payout_milestone(&w.organizer, &id, &1, &5_000);
    assert_eq!(w.tix.try_release_payout(&w.organizer, &id), Err(Ok(Error::MilestoneNotMet)));

    w.tix.validate_and_check_in(&ticket_id, &w.organizer);
    let released = w.tix.release_payout(&w.organizer, &id);
    assert_eq!(released, UNIT * 975 / 20); // 50% of 97.5
    assert!(w.tix.get_event(&id).partial_released);
    assert_eq!(w.tix.try_release_payout(&w.organizer, &id), Err(Ok(Error::AlreadyReleased)));

    w.tix.complete_event(&w.organizer, &id);
    w.tix.release_payout(&w.organizer, &id);
    assert_eq!(w.tix.escrow_balance(&id), 0);
}

#[test]
fn cancelled_event_refunds_holder_from_escrow() {
    let w = world();
    let id = w.event(10, 100 * UNIT, 0, 0);
    let buyer = w.funded_user(100 * UNIT);
    let ticket_id = w.buy(&buyer, id);
    assert_eq!(w.tix.try_claim_refund(&buyer, &ticket_id), Err(Ok(Error::EventNotCancelled)));

    w.tix.cancel_event(&w.organizer, &id);
    assert_eq!(w.tix.event_status(&id), EventStatus::Cancelled);
    assert_eq!(w.tix.try_release_payout(&w.organizer, &id), Err(Ok(Error::EventCancelled)));
    assert_eq!(w.tix.try_mint_ticket(&buyer, &buyer, &id, &0), Err(Ok(Error::EventCancelled)));

    let refunded = w.tix.claim_refund(&buyer, &ticket_id);
    assert!(emitted(&w.env, &w.tix.address, "refunded"));
    assert_eq!(refunded, UNIT * 975 / 10);
    assert_eq!(w.usdc.balance(&buyer), UNIT * 975 / 10); // spent 100, fee 2.5 stays with treasury
    assert_eq!(w.usdc.balance(&w.treasury), UNIT * 25 / 10);
    assert_eq!(w.tix.escrow_balance(&id), 0);
    assert!(w.tix.get_ticket(&ticket_id).refunded);
    assert_eq!(w.tix.try_claim_refund(&buyer, &ticket_id), Err(Ok(Error::AlreadyRefunded)));
}

#[test]
fn resale_pays_fee_royalty_and_seller() {
    let w = world();
    let royalty_bps = 1_000u32; // 10%
    let id = w.event_with(10, 20 * UNIT, 2, 25 * UNIT, 0, royalty_bps);
    let alice = w.funded_user(20 * UNIT);
    let bob = w.funded_user(100 * UNIT);
    let t = w.buy(&alice, id);

    let price = 25 * UNIT;
    w.tix.transfer_ticket(&t, &alice, &bob, &price);
    assert!(emitted(&w.env, &w.tix.address, "royalty_paid"));

    let fee = price * FEE_BPS as i128 / 10_000;
    let royalty = price * royalty_bps as i128 / 10_000;
    let seller = price - fee - royalty;
    // royalty 2.5 USDC → 70/30 organizer/artist = 1.75 / 0.75
    assert_eq!(w.usdc.balance(&alice), seller);
    assert_eq!(w.usdc.balance(&bob), 75 * UNIT);
    assert_eq!(w.usdc.balance(&w.organizer), royalty * 7_000 / 10_000);
    assert_eq!(w.usdc.balance(&w.artist), royalty - royalty * 7_000 / 10_000);
    assert_eq!(w.usdc.balance(&w.treasury), 20 * UNIT * FEE_BPS as i128 / 10_000 + fee);
    assert_eq!(w.tix.get_ticket(&t).owner, bob);
}

#[test]
fn stranger_cannot_complete_cancel_or_release() {
    let w = world();
    let id = w.event(10, UNIT, 0, 0);
    let stranger = Address::generate(&w.env);
    assert_eq!(w.tix.try_complete_event(&stranger, &id), Err(Ok(Error::NotEventOrganizer)));
    assert_eq!(w.tix.try_cancel_event(&stranger, &id), Err(Ok(Error::NotEventOrganizer)));
    assert_eq!(w.tix.try_release_payout(&stranger, &id), Err(Ok(Error::NotEventOrganizer)));
    assert_eq!(w.tix.try_set_payout_milestone(&stranger, &id, &1, &5_000), Err(Ok(Error::NotEventOrganizer)));
}

#[test]
fn only_ticket_owner_can_claim_refund() {
    let w = world();
    let id = w.event(10, UNIT, 0, 0);
    let buyer = w.funded_user(UNIT);
    let mallory = Address::generate(&w.env);
    let t = w.buy(&buyer, id);
    w.tix.cancel_event(&w.organizer, &id);
    assert_eq!(w.tix.try_claim_refund(&mallory, &t), Err(Ok(Error::NotOwner)));
}

#[test]
#[should_panic]
fn complete_event_requires_caller_auth() {
    let w = world();
    let id = w.event(10, 0, 0, 0);
    w.env.mock_auths(&[]);
    w.tix.complete_event(&w.organizer, &id);
}

#[test]
#[should_panic]
fn claim_refund_requires_owner_auth() {
    let w = world();
    let id = w.event(10, UNIT, 0, 0);
    let buyer = w.funded_user(UNIT);
    let t = w.buy(&buyer, id);
    w.tix.cancel_event(&w.organizer, &id);
    w.env.mock_auths(&[]);
    w.tix.claim_refund(&buyer, &t);
}
