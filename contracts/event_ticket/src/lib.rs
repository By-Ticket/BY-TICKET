#![no_std]
//! BY Tickets — `event_ticket` contract.
//!
//! Source of truth for events, ticket ownership, transfers and check-ins.
//!
//! Guarantees enforced here (not just in the app):
//! - **No oversell**: `sold < capacity` checked for the event and the tier in the same
//!   invocation that mints, so concurrent purchases can never exceed capacity.
//! - **No double entry**: `validate_and_check_in` flips `checked_in` once; replays fail.
//! - **Controlled transfers**: per-event `max_transfers` and `resale_cap`; priced resales
//!   settle atomically. The seller receives the price minus the platform fee and any
//!   organizer royalty.
//! - **Escrow**: the platform fee is paid to the treasury at purchase; the organizer share
//!   stays in this contract until `complete_event` + `release_payout` (or a configured
//!   check-in milestone). Cancelled events refund holders from escrow instead.
//!
//! Roles: `admin` (platform), approved `organizer`s, per-event `scanner`s.
//! Every state change emits an event for the off-chain indexer.

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, panic_with_error, symbol_short,
    token, Address, BytesN, ContractExecutable, Env, Symbol, Vec,
};

const BPS_DENOMINATOR: i128 = 10_000;
/// Hard ceiling for the platform fee (20%), even for the admin.
pub const MAX_FEE_BPS: u32 = 2_000;
/// Hard ceiling for the organizer resale royalty (15%).
pub const MAX_ROYALTY_BPS: u32 = 1_500;
pub const MAX_SPLITS: u32 = 5;
pub const MAX_TIERS: u32 = 10;
/// One whole unit of the payment token (7 decimals), used for points-per-unit math.
const TOKEN_UNIT: i128 = 10_000_000;

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP: u32 = 120 * DAY_IN_LEDGERS;
const THRESHOLD: u32 = BUMP - 7 * DAY_IN_LEDGERS;

// ---- errors ---------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotOrganizer = 1,
    NotEventOrganizer = 2,
    NotScanner = 3,
    EventNotFound = 4,
    TierNotFound = 5,
    TicketNotFound = 6,
    SoldOut = 7,
    TierSoldOut = 8,
    SalesClosed = 9,
    NotOwner = 10,
    AlreadyCheckedIn = 11,
    TransferLimitReached = 12,
    ResaleCapExceeded = 13,
    InvalidSplits = 14,
    InvalidAmount = 15,
    InvalidCapacity = 16,
    InvalidRecipient = 17,
    TooManyTiers = 18,
    FeeTooHigh = 19,
    Paused = 20,
    RoyaltyTooHigh = 21,
    EventNotLive = 22,
    EventNotCompleted = 23,
    EventCancelled = 24,
    TooEarly = 25,
    AlreadyReleased = 26,
    AlreadyRefunded = 27,
    NothingToRelease = 28,
    MilestoneNotMet = 29,
    EventNotCancelled = 30,
}

// ---- types ----------------------------------------------------------------------

/// A revenue recipient and its share of the post-fee proceeds.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Split {
    pub recipient: Address,
    pub bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Tier {
    /// Price in payment-token units (7 decimals). 0 = free.
    pub price: i128,
    pub capacity: u32,
    pub sold: u32,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EventStatus {
    Live,
    Completed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventInfo {
    pub organizer: Address,
    /// Event-wide cap across all tiers.
    pub capacity: u32,
    pub sold: u32,
    pub checked_in: u32,
    /// How many times a single ticket may change hands. 0 = non-transferable.
    pub max_transfers: u32,
    /// Max price (payment-token units) a ticket may be resold for. 0 = gifts only.
    pub resale_cap: i128,
    /// Platform fee snapshot at creation, so later fee changes don't affect live events.
    pub fee_bps: u32,
    /// Share of a resale price paid to `splits`. Capped at `MAX_ROYALTY_BPS`.
    pub royalty_bps: u32,
    /// Ledger unix time after which the organizer/admin may call `complete_event`. 0 = immediately.
    pub ends_at: u64,
    pub status: EventStatus,
    /// Optional partial payout: check-ins required before `release_payout` while still Live. 0 = off.
    pub min_checkins_partial: u32,
    /// Optional partial payout: bps of current escrow released at the milestone. 0 = off.
    pub partial_release_bps: u32,
    pub partial_released: bool,
    pub payout_released: bool,
    pub splits: Vec<Split>,
    pub tiers: Vec<Tier>,
    pub sales_open: bool,
    /// Hash of the off-chain metadata (title, venue, date, ...) for integrity checks.
    pub metadata_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Ticket {
    pub event_id: u64,
    pub tier: u32,
    pub owner: Address,
    pub transfers: u32,
    pub checked_in: bool,
    /// Ledger close time of check-in (0 until used).
    pub checked_in_at: u64,
    /// Organizer-share (post-fee) escrowed at mint, used for refunds.
    pub paid: i128,
    pub refunded: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub payment_token: Address,
    pub treasury: Address,
    pub fee_bps: u32,
    pub rewards: Address,
    pub badge: Address,
    /// BY Points (7 decimals) awarded per 1.0 of payment token spent.
    pub purchase_points_per_unit: i128,
    /// BY Points (7 decimals) awarded on check-in.
    pub attendance_points: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Paused,
    NextEventId,
    NextTicketId,
    Organizer(Address),
    Event(u64),
    Ticket(u64),
    Scanner(u64, Address),
    Escrow(u64),
}

// ---- cross-contract interfaces ----------------------------------------------------

#[contractclient(name = "PointsClient")]
pub trait PointsInterface {
    fn mint(env: Env, minter: Address, to: Address, amount: i128, reason: Symbol);
}

#[contractclient(name = "BadgeClient")]
pub trait BadgeInterface {
    fn mint_badge(env: Env, minter: Address, event_id: u64, attendee: Address) -> u64;
}

// ---- events ---------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventCreated {
    #[topic]
    pub event_id: u64,
    #[topic]
    pub organizer: Address,
    pub capacity: u32,
    pub price: i128,
    pub max_transfers: u32,
    pub resale_cap: i128,
    pub metadata_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventUpdated {
    #[topic]
    pub event_id: u64,
    pub capacity: u32,
    pub max_transfers: u32,
    pub resale_cap: i128,
    pub sales_open: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TierAdded {
    #[topic]
    pub event_id: u64,
    pub tier: u32,
    pub price: i128,
    pub capacity: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TicketMinted {
    #[topic]
    pub event_id: u64,
    #[topic]
    pub owner: Address,
    pub ticket_id: u64,
    pub tier: u32,
    pub price: i128,
    pub payer: Address,
    pub platform_fee: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TicketTransferred {
    #[topic]
    pub ticket_id: u64,
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub price: i128,
    pub transfers: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CheckedIn {
    #[topic]
    pub event_id: u64,
    #[topic]
    pub ticket_id: u64,
    pub owner: Address,
    pub scanner: Address,
    pub badge_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScannerSet {
    #[topic]
    pub event_id: u64,
    #[topic]
    pub scanner: Address,
    pub enabled: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrganizerSet {
    #[topic]
    pub organizer: Address,
    pub approved: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigUpdated {
    pub fee_bps: u32,
    pub treasury: Address,
    pub purchase_points_per_unit: i128,
    pub attendance_points: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PausedSet {
    pub paused: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrowed {
    #[topic]
    pub event_id: u64,
    pub amount: i128,
    pub payer: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Released {
    #[topic]
    pub event_id: u64,
    pub amount: i128,
    pub remaining: i128,
    pub partial: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Refunded {
    #[topic]
    pub event_id: u64,
    #[topic]
    pub ticket_id: u64,
    pub owner: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoyaltyPaid {
    #[topic]
    pub event_id: u64,
    #[topic]
    pub ticket_id: u64,
    pub amount: i128,
}

// ---- contract -------------------------------------------------------------------

#[contract]
pub struct EventTicket;

#[contractimpl]
impl EventTicket {
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        admin: Address,
        payment_token: Address,
        treasury: Address,
        fee_bps: u32,
        rewards: Address,
        badge: Address,
        purchase_points_per_unit: i128,
        attendance_points: i128,
    ) {
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::FeeTooHigh);
        }
        if purchase_points_per_unit < 0 || attendance_points < 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let config = Config {
            admin,
            payment_token,
            treasury,
            fee_bps,
            rewards,
            badge,
            purchase_points_per_unit,
            attendance_points,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::NextEventId, &1u64);
        env.storage().instance().set(&DataKey::NextTicketId, &1u64);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    // ---- admin ----------------------------------------------------------------

    pub fn approve_organizer(env: Env, organizer: Address) {
        require_admin(&env);
        env.storage().persistent().set(&DataKey::Organizer(organizer.clone()), &true);
        bump(&env, &DataKey::Organizer(organizer.clone()));
        OrganizerSet { organizer, approved: true }.publish(&env);
    }

    /// Revoking stops new events; existing events keep selling and checking in.
    pub fn revoke_organizer(env: Env, organizer: Address) {
        require_admin(&env);
        env.storage().persistent().remove(&DataKey::Organizer(organizer.clone()));
        OrganizerSet { organizer, approved: false }.publish(&env);
    }

    pub fn set_fee(env: Env, fee_bps: u32, treasury: Address) -> Result<(), Error> {
        let mut config = require_admin(&env);
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        config.fee_bps = fee_bps;
        config.treasury = treasury;
        save_config(&env, &config);
        publish_config(&env, &config);
        Ok(())
    }

    pub fn set_reward_rates(env: Env, purchase_points_per_unit: i128, attendance_points: i128) -> Result<(), Error> {
        let mut config = require_admin(&env);
        if purchase_points_per_unit < 0 || attendance_points < 0 {
            return Err(Error::InvalidAmount);
        }
        config.purchase_points_per_unit = purchase_points_per_unit;
        config.attendance_points = attendance_points;
        save_config(&env, &config);
        publish_config(&env, &config);
        Ok(())
    }

    /// Emergency stop for sales and transfers. Check-in keeps working so doors stay open.
    pub fn set_paused(env: Env, paused: bool) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &paused);
        PausedSet { paused }.publish(&env);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let mut config = require_admin(&env);
        config.admin = new_admin;
        save_config(&env, &config);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_admin(&env);
        env.deployer().update_current_contract(ContractExecutable::Wasm(new_wasm_hash));
    }

    // ---- organizer --------------------------------------------------------------

    /// Create an event with a default tier (`price`, `capacity`).
    /// `splits` share the post-fee proceeds and must sum to exactly 10 000 bps.
    /// Organizer proceeds stay in escrow until `complete_event` + `release_payout`.
    /// `ends_at` is unix time; 0 means the event may be completed immediately.
    /// `royalty_bps` is the organizer share of each resale, capped at `MAX_ROYALTY_BPS`.
    #[allow(clippy::too_many_arguments)]
    pub fn create_event(
        env: Env,
        organizer: Address,
        capacity: u32,
        price: i128,
        max_transfers: u32,
        resale_cap: i128,
        splits: Vec<Split>,
        metadata_hash: BytesN<32>,
        ends_at: u64,
        royalty_bps: u32,
    ) -> Result<u64, Error> {
        organizer.require_auth();
        let config = load_config(&env);
        let org_key = DataKey::Organizer(organizer.clone());
        if !env.storage().persistent().has(&org_key) {
            return Err(Error::NotOrganizer);
        }
        bump(&env, &org_key);
        if capacity == 0 {
            return Err(Error::InvalidCapacity);
        }
        if price < 0 || resale_cap < 0 {
            return Err(Error::InvalidAmount);
        }
        if royalty_bps > MAX_ROYALTY_BPS {
            return Err(Error::RoyaltyTooHigh);
        }
        validate_splits(&splits)?;

        let event_id: u64 = env.storage().instance().get(&DataKey::NextEventId).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextEventId, &(event_id + 1));

        let mut tiers = Vec::new(&env);
        tiers.push_back(Tier { price, capacity, sold: 0 });
        let event = EventInfo {
            organizer: organizer.clone(),
            capacity,
            sold: 0,
            checked_in: 0,
            max_transfers,
            resale_cap,
            fee_bps: config.fee_bps,
            royalty_bps,
            ends_at,
            status: EventStatus::Live,
            min_checkins_partial: 0,
            partial_release_bps: 0,
            partial_released: false,
            payout_released: false,
            splits,
            tiers,
            sales_open: true,
            metadata_hash: metadata_hash.clone(),
        };
        save_event(&env, event_id, &event);

        EventCreated { event_id, organizer, capacity, price, max_transfers, resale_cap, metadata_hash }.publish(&env);
        Ok(event_id)
    }

    /// Add a ticket tier (e.g. VIP). Tier capacity is bounded by the event-wide capacity.
    pub fn add_tier(env: Env, event_id: u64, price: i128, capacity: u32) -> Result<u32, Error> {
        let mut event = load_event(&env, event_id)?;
        require_live(&event)?;
        event.organizer.require_auth();
        if event.tiers.len() >= MAX_TIERS {
            return Err(Error::TooManyTiers);
        }
        if price < 0 {
            return Err(Error::InvalidAmount);
        }
        if capacity == 0 || capacity > event.capacity {
            return Err(Error::InvalidCapacity);
        }
        let tier = event.tiers.len();
        event.tiers.push_back(Tier { price, capacity, sold: 0 });
        save_event(&env, event_id, &event);
        TierAdded { event_id, tier, price, capacity }.publish(&env);
        Ok(tier)
    }

    /// Update event-wide capacity and transfer rules. Capacity can't drop below tickets sold.
    pub fn update_event(
        env: Env,
        event_id: u64,
        capacity: u32,
        max_transfers: u32,
        resale_cap: i128,
        sales_open: bool,
    ) -> Result<(), Error> {
        let mut event = load_event(&env, event_id)?;
        require_live(&event)?;
        event.organizer.require_auth();
        if capacity == 0 || capacity < event.sold {
            return Err(Error::InvalidCapacity);
        }
        if resale_cap < 0 {
            return Err(Error::InvalidAmount);
        }
        event.capacity = capacity;
        event.max_transfers = max_transfers;
        event.resale_cap = resale_cap;
        event.sales_open = sales_open;
        save_event(&env, event_id, &event);
        EventUpdated { event_id, capacity, max_transfers, resale_cap, sales_open }.publish(&env);
        Ok(())
    }

    pub fn set_scanner(env: Env, event_id: u64, scanner: Address, enabled: bool) -> Result<(), Error> {
        let event = load_event(&env, event_id)?;
        event.organizer.require_auth();
        let key = DataKey::Scanner(event_id, scanner.clone());
        if enabled {
            env.storage().persistent().set(&key, &true);
            bump(&env, &key);
        } else {
            env.storage().persistent().remove(&key);
        }
        ScannerSet { event_id, scanner, enabled }.publish(&env);
        Ok(())
    }

    /// Configure an optional partial payout while the event is still Live: once
    /// `min_checkins` attendees have checked in, `release_payout` may send
    /// `partial_release_bps` of the current escrow to `splits`.
    pub fn set_payout_milestone(
        env: Env,
        caller: Address,
        event_id: u64,
        min_checkins: u32,
        partial_release_bps: u32,
    ) -> Result<(), Error> {
        let mut event = load_event(&env, event_id)?;
        require_manager(&env, &caller, &event)?;
        require_live(&event)?;
        if event.partial_released || event.payout_released {
            return Err(Error::AlreadyReleased);
        }
        if partial_release_bps > BPS_DENOMINATOR as u32 {
            return Err(Error::InvalidAmount);
        }
        event.min_checkins_partial = min_checkins;
        event.partial_release_bps = partial_release_bps;
        save_event(&env, event_id, &event);
        Ok(())
    }

    /// Organizer or admin marks the event finished. Requires ledger time >= `ends_at`
    /// (or `ends_at == 0`). Unlocks the full escrow for `release_payout`.
    pub fn complete_event(env: Env, caller: Address, event_id: u64) -> Result<(), Error> {
        let mut event = load_event(&env, event_id)?;
        require_manager(&env, &caller, &event)?;
        require_live(&event)?;
        if event.ends_at > 0 && env.ledger().timestamp() < event.ends_at {
            return Err(Error::TooEarly);
        }
        event.status = EventStatus::Completed;
        event.sales_open = false;
        save_event(&env, event_id, &event);
        Ok(())
    }

    /// Organizer or admin cancels a live event. Sales stop; holders may `claim_refund`.
    /// Cannot cancel after any escrow has been released.
    pub fn cancel_event(env: Env, caller: Address, event_id: u64) -> Result<(), Error> {
        let mut event = load_event(&env, event_id)?;
        require_manager(&env, &caller, &event)?;
        require_live(&event)?;
        if event.partial_released || event.payout_released {
            return Err(Error::AlreadyReleased);
        }
        event.status = EventStatus::Cancelled;
        event.sales_open = false;
        save_event(&env, event_id, &event);
        Ok(())
    }

    /// Pay escrowed organizer funds to `event.splits`. Full remaining balance after
    /// `complete_event`; optional partial share while Live if the check-in milestone is met.
    pub fn release_payout(env: Env, caller: Address, event_id: u64) -> Result<i128, Error> {
        let mut event = load_event(&env, event_id)?;
        require_manager(&env, &caller, &event)?;
        if event.status == EventStatus::Cancelled {
            return Err(Error::EventCancelled);
        }
        if event.payout_released {
            return Err(Error::AlreadyReleased);
        }

        let escrow = load_escrow(&env, event_id);
        let (amount, partial) = if event.status == EventStatus::Completed {
            (escrow, false)
        } else if event.partial_released {
            return Err(Error::AlreadyReleased);
        } else if event.min_checkins_partial > 0 && event.partial_release_bps > 0 {
            if event.checked_in < event.min_checkins_partial {
                return Err(Error::MilestoneNotMet);
            }
            let part = escrow * event.partial_release_bps as i128 / BPS_DENOMINATOR;
            (part, true)
        } else {
            return Err(Error::EventNotCompleted);
        };

        if amount <= 0 {
            return Err(Error::NothingToRelease);
        }

        let config = load_config(&env);
        pay_splits_from_contract(&env, &config, &event.splits, amount);
        let remaining = escrow - amount;
        save_escrow(&env, event_id, remaining);
        if partial {
            event.partial_released = true;
        } else {
            event.payout_released = true;
        }
        save_event(&env, event_id, &event);
        Released { event_id, amount, remaining, partial }.publish(&env);
        Ok(amount)
    }

    /// Ticket holder recovers the escrowed organizer-share of their purchase after cancel.
    pub fn claim_refund(env: Env, owner: Address, ticket_id: u64) -> Result<i128, Error> {
        owner.require_auth();
        let mut ticket = load_ticket(&env, ticket_id)?;
        if ticket.owner != owner {
            return Err(Error::NotOwner);
        }
        if ticket.refunded {
            return Err(Error::AlreadyRefunded);
        }
        let event = load_event(&env, ticket.event_id)?;
        if event.status != EventStatus::Cancelled {
            return Err(Error::EventNotCancelled);
        }

        let amount = ticket.paid;
        if amount > 0 {
            let escrow = load_escrow(&env, ticket.event_id);
            if amount > escrow {
                return Err(Error::NothingToRelease);
            }
            let config = load_config(&env);
            token::TokenClient::new(&env, &config.payment_token).transfer(
                &env.current_contract_address(),
                &owner,
                &amount,
            );
            save_escrow(&env, ticket.event_id, escrow - amount);
        }
        ticket.refunded = true;
        save_ticket(&env, ticket_id, &ticket);
        Refunded { event_id: ticket.event_id, ticket_id, owner, amount }.publish(&env);
        Ok(amount)
    }

    // ---- customers --------------------------------------------------------------

    /// Buy a ticket. `payer` pays (wallet user, or the platform after a mobile-money
    /// on-ramp settles); `owner` receives the ticket and the purchase points.
    pub fn mint_ticket(env: Env, payer: Address, owner: Address, event_id: u64, tier: u32) -> Result<u64, Error> {
        payer.require_auth();
        require_not_paused(&env)?;
        let config = load_config(&env);
        let mut event = load_event(&env, event_id)?;
        require_live(&event)?;
        if !event.sales_open {
            return Err(Error::SalesClosed);
        }
        if event.sold >= event.capacity {
            return Err(Error::SoldOut);
        }
        let mut t = event.tiers.get(tier).ok_or(Error::TierNotFound)?;
        if t.sold >= t.capacity {
            return Err(Error::TierSoldOut);
        }

        let (platform_fee, escrowed) = settle_sale(&env, &config, &event, event_id, &payer, t.price);

        t.sold += 1;
        event.tiers.set(tier, t.clone());
        event.sold += 1;
        save_event(&env, event_id, &event);

        let ticket_id: u64 = env.storage().instance().get(&DataKey::NextTicketId).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextTicketId, &(ticket_id + 1));
        let ticket = Ticket {
            event_id,
            tier,
            owner: owner.clone(),
            transfers: 0,
            checked_in: false,
            checked_in_at: 0,
            paid: escrowed,
            refunded: false,
        };
        save_ticket(&env, ticket_id, &ticket);

        let points = t.price * config.purchase_points_per_unit / TOKEN_UNIT;
        if points > 0 {
            PointsClient::new(&env, &config.rewards).mint(
                &env.current_contract_address(),
                &owner,
                &points,
                &symbol_short!("purchase"),
            );
        }

        TicketMinted { event_id, owner, ticket_id, tier, price: t.price, payer, platform_fee }.publish(&env);
        Ok(ticket_id)
    }

    /// Transfer or resell a ticket under the event's rules. If `price > 0`, `to`
    /// pays `from` atomically in the payment token, so the resale cap is enforced
    /// on the actual on-chain payment.
    pub fn transfer_ticket(env: Env, ticket_id: u64, from: Address, to: Address, price: i128) -> Result<(), Error> {
        from.require_auth();
        require_not_paused(&env)?;
        let mut ticket = load_ticket(&env, ticket_id)?;
        if ticket.owner != from {
            return Err(Error::NotOwner);
        }
        if from == to {
            return Err(Error::InvalidRecipient);
        }
        if ticket.checked_in {
            return Err(Error::AlreadyCheckedIn);
        }
        if ticket.refunded {
            return Err(Error::AlreadyRefunded);
        }
        let event = load_event(&env, ticket.event_id)?;
        require_live(&event)?;
        if ticket.transfers >= event.max_transfers {
            return Err(Error::TransferLimitReached);
        }
        if price < 0 {
            return Err(Error::InvalidAmount);
        }
        if price > event.resale_cap {
            return Err(Error::ResaleCapExceeded);
        }
        if price > 0 {
            to.require_auth();
            let config = load_config(&env);
            let (fee, royalty, seller_amount, royalty_amounts) =
                compute_resale(&env, price, event.fee_bps, event.royalty_bps, &event.splits);
            let token = token::TokenClient::new(&env, &config.payment_token);
            if fee > 0 {
                token.transfer(&to, &config.treasury, &fee);
            }
            for (s, amount) in event.splits.iter().zip(royalty_amounts.iter()) {
                if amount > 0 {
                    token.transfer(&to, &s.recipient, &amount);
                }
            }
            if seller_amount > 0 {
                token.transfer(&to, &from, &seller_amount);
            }
            if royalty > 0 {
                RoyaltyPaid { event_id: ticket.event_id, ticket_id, amount: royalty }.publish(&env);
            }
        }

        ticket.owner = to.clone();
        ticket.transfers += 1;
        save_ticket(&env, ticket_id, &ticket);
        TicketTransferred { ticket_id, from, to, price, transfers: ticket.transfers }.publish(&env);
        Ok(())
    }

    // ---- door -------------------------------------------------------------------

    /// Mark a ticket as used. Callable by the event organizer or an enabled scanner.
    /// Fails with `AlreadyCheckedIn` on any replay. Awards attendance points and the
    /// proof-of-attendance badge to the ticket owner. Returns the badge id.
    pub fn validate_and_check_in(env: Env, ticket_id: u64, scanner: Address) -> Result<u64, Error> {
        scanner.require_auth();
        let config = load_config(&env);
        let mut ticket = load_ticket(&env, ticket_id)?;
        let mut event = load_event(&env, ticket.event_id)?;
        if event.status == EventStatus::Cancelled {
            return Err(Error::EventCancelled);
        }
        if ticket.refunded {
            return Err(Error::AlreadyRefunded);
        }
        if scanner != event.organizer {
            let key = DataKey::Scanner(ticket.event_id, scanner.clone());
            if !env.storage().persistent().has(&key) {
                return Err(Error::NotScanner);
            }
        }
        if ticket.checked_in {
            return Err(Error::AlreadyCheckedIn);
        }

        ticket.checked_in = true;
        ticket.checked_in_at = env.ledger().timestamp();
        save_ticket(&env, ticket_id, &ticket);
        event.checked_in += 1;
        save_event(&env, ticket.event_id, &event);

        let me = env.current_contract_address();
        if config.attendance_points > 0 {
            PointsClient::new(&env, &config.rewards).mint(
                &me,
                &ticket.owner,
                &config.attendance_points,
                &symbol_short!("attend"),
            );
        }
        let badge_id = BadgeClient::new(&env, &config.badge).mint_badge(&me, &ticket.event_id, &ticket.owner);

        CheckedIn { event_id: ticket.event_id, ticket_id, owner: ticket.owner, scanner, badge_id }.publish(&env);
        Ok(badge_id)
    }

    // ---- views ------------------------------------------------------------------

    pub fn get_event(env: Env, event_id: u64) -> Result<EventInfo, Error> {
        load_event(&env, event_id)
    }

    pub fn get_ticket(env: Env, ticket_id: u64) -> Result<Ticket, Error> {
        load_ticket(&env, ticket_id)
    }

    pub fn is_organizer(env: Env, organizer: Address) -> bool {
        env.storage().persistent().has(&DataKey::Organizer(organizer))
    }

    pub fn is_scanner(env: Env, event_id: u64, scanner: Address) -> bool {
        env.storage().persistent().has(&DataKey::Scanner(event_id, scanner))
    }

    pub fn config(env: Env) -> Config {
        load_config(&env)
    }

    pub fn paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    pub fn escrow_balance(env: Env, event_id: u64) -> Result<i128, Error> {
        let _ = load_event(&env, event_id)?;
        Ok(load_escrow(&env, event_id))
    }

    pub fn event_status(env: Env, event_id: u64) -> Result<EventStatus, Error> {
        Ok(load_event(&env, event_id)?.status)
    }

    /// Preview how a sale at `price` splits for `event_id`: (platform fee, per-split amounts).
    pub fn quote_split(env: Env, event_id: u64, price: i128) -> Result<(i128, Vec<i128>), Error> {
        if price < 0 {
            return Err(Error::InvalidAmount);
        }
        let event = load_event(&env, event_id)?;
        Ok(compute_split(&env, price, event.fee_bps, &event.splits))
    }

    pub fn version(_env: Env) -> u32 {
        2
    }
}

// ---- internals --------------------------------------------------------------------

fn load_config(env: &Env) -> Config {
    env.storage().instance().extend_ttl(THRESHOLD, BUMP);
    env.storage().instance().get(&DataKey::Config).unwrap()
}

fn save_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
}

fn publish_config(env: &Env, config: &Config) {
    ConfigUpdated {
        fee_bps: config.fee_bps,
        treasury: config.treasury.clone(),
        purchase_points_per_unit: config.purchase_points_per_unit,
        attendance_points: config.attendance_points,
    }
    .publish(env);
}

fn require_admin(env: &Env) -> Config {
    let config = load_config(env);
    config.admin.require_auth();
    config
}

fn require_not_paused(env: &Env) -> Result<(), Error> {
    if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
        return Err(Error::Paused);
    }
    Ok(())
}

fn require_live(event: &EventInfo) -> Result<(), Error> {
    match event.status {
        EventStatus::Live => Ok(()),
        EventStatus::Cancelled => Err(Error::EventCancelled),
        EventStatus::Completed => Err(Error::EventNotLive),
    }
}

fn require_manager(env: &Env, caller: &Address, event: &EventInfo) -> Result<(), Error> {
    caller.require_auth();
    let config = load_config(env);
    if *caller == event.organizer || *caller == config.admin {
        Ok(())
    } else {
        Err(Error::NotEventOrganizer)
    }
}

fn load_escrow(env: &Env, event_id: u64) -> i128 {
    env.storage().persistent().get(&DataKey::Escrow(event_id)).unwrap_or(0)
}

fn save_escrow(env: &Env, event_id: u64, amount: i128) {
    let key = DataKey::Escrow(event_id);
    if amount == 0 {
        env.storage().persistent().remove(&key);
    } else {
        env.storage().persistent().set(&key, &amount);
        bump(env, &key);
    }
}

fn add_escrow(env: &Env, event_id: u64, delta: i128) {
    save_escrow(env, event_id, load_escrow(env, event_id) + delta);
}

fn bump(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(key, THRESHOLD, BUMP);
}

fn load_event(env: &Env, event_id: u64) -> Result<EventInfo, Error> {
    let key = DataKey::Event(event_id);
    let event = env.storage().persistent().get(&key).ok_or(Error::EventNotFound)?;
    bump(env, &key);
    Ok(event)
}

fn save_event(env: &Env, event_id: u64, event: &EventInfo) {
    let key = DataKey::Event(event_id);
    env.storage().persistent().set(&key, event);
    bump(env, &key);
}

fn load_ticket(env: &Env, ticket_id: u64) -> Result<Ticket, Error> {
    let key = DataKey::Ticket(ticket_id);
    let ticket = env.storage().persistent().get(&key).ok_or(Error::TicketNotFound)?;
    bump(env, &key);
    Ok(ticket)
}

fn save_ticket(env: &Env, ticket_id: u64, ticket: &Ticket) {
    let key = DataKey::Ticket(ticket_id);
    env.storage().persistent().set(&key, ticket);
    bump(env, &key);
}

fn validate_splits(splits: &Vec<Split>) -> Result<(), Error> {
    if splits.is_empty() || splits.len() > MAX_SPLITS {
        return Err(Error::InvalidSplits);
    }
    let mut total: u32 = 0;
    for s in splits.iter() {
        if s.bps == 0 {
            return Err(Error::InvalidSplits);
        }
        total = total.checked_add(s.bps).ok_or(Error::InvalidSplits)?;
    }
    if total != BPS_DENOMINATOR as u32 {
        return Err(Error::InvalidSplits);
    }
    Ok(())
}

/// Split `net` across `splits`. Rounding dust goes to the last recipient.
fn split_net(env: &Env, net: i128, splits: &Vec<Split>) -> Vec<i128> {
    let mut amounts = Vec::new(env);
    let mut paid: i128 = 0;
    let last = splits.len() - 1;
    for (i, s) in splits.iter().enumerate() {
        let amount = if i as u32 == last { net - paid } else { net * s.bps as i128 / BPS_DENOMINATOR };
        paid += amount;
        amounts.push_back(amount);
    }
    amounts
}

/// Platform fee first, then each split's share of the remainder. Rounding dust goes to
/// the last split so the amounts always sum to exactly `price`.
fn compute_split(env: &Env, price: i128, fee_bps: u32, splits: &Vec<Split>) -> (i128, Vec<i128>) {
    let fee = price * fee_bps as i128 / BPS_DENOMINATOR;
    (fee, split_net(env, price - fee, splits))
}

fn compute_resale(
    env: &Env,
    price: i128,
    fee_bps: u32,
    royalty_bps: u32,
    splits: &Vec<Split>,
) -> (i128, i128, i128, Vec<i128>) {
    let fee = price * fee_bps as i128 / BPS_DENOMINATOR;
    let royalty = price * royalty_bps as i128 / BPS_DENOMINATOR;
    let seller = price - fee - royalty;
    (fee, royalty, seller, split_net(env, royalty, splits))
}

fn pay_splits_from_contract(env: &Env, config: &Config, splits: &Vec<Split>, amount: i128) {
    let token = token::TokenClient::new(env, &config.payment_token);
    let from = env.current_contract_address();
    for (s, share) in splits.iter().zip(split_net(env, amount, splits).iter()) {
        if share > 0 {
            token.transfer(&from, &s.recipient, &share);
        }
    }
}

/// Pull `price` from `payer`: platform fee to treasury, organizer net into contract escrow.
/// Returns `(platform_fee, escrowed_net)`.
fn settle_sale(
    env: &Env,
    config: &Config,
    event: &EventInfo,
    event_id: u64,
    payer: &Address,
    price: i128,
) -> (i128, i128) {
    if price == 0 {
        return (0, 0);
    }
    let (fee, amounts) = compute_split(env, price, event.fee_bps, &event.splits);
    let mut net: i128 = 0;
    for amount in amounts.iter() {
        net += amount;
    }
    let token = token::TokenClient::new(env, &config.payment_token);
    if fee > 0 {
        token.transfer(payer, &config.treasury, &fee);
    }
    if net > 0 {
        token.transfer(payer, &env.current_contract_address(), &net);
        add_escrow(env, event_id, net);
        Escrowed { event_id, amount: net, payer: payer.clone() }.publish(env);
    }
    (fee, net)
}

#[cfg(test)]
mod test;
