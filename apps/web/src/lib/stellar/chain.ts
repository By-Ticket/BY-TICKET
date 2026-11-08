import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  contract,
  rpc,
  type Transaction,
} from "@stellar/stellar-sdk";

export interface ChainConfig {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  ticketContractId: string;
  usdcContractId: string;
  usdcCode: string;
  usdcIssuer: string;
  isTestnet: boolean;
}

export interface OnChainTier {
  price: bigint;
  capacity: number;
  sold: number;
}

export type OnChainEventStatus = "Live" | "Completed" | "Cancelled";

export interface OnChainEvent {
  organizer: string;
  capacity: number;
  sold: number;
  checkedIn: number;
  maxTransfers: number;
  resaleCap: bigint;
  salesOpen: boolean;
  feeBps: number;
  royaltyBps: number;
  endsAt: bigint;
  status?: OnChainEventStatus;
  payoutReleased: boolean;
  partialReleased: boolean;
  minCheckinsPartial: number;
  partialReleaseBps: number;
  metadataHash: string;
  splits: { recipient: string; bps: number }[];
  tiers: OnChainTier[];
}

interface ContractCall<T> {
  result: T;
  toXdr?: () => string;
  signAndSend?: () => Promise<{ result: T; sendTransactionResponse?: { hash?: string } }>;
}

interface UsdcContract {
  balance: (args: { id: string }) => Promise<ContractCall<bigint | number | string>>;
  mint: (args: { to: string; amount: bigint }) => Promise<ContractCall<unknown> & {
    toXdr: () => string;
    signAndSend: () => Promise<{ result: unknown; sendTransactionResponse?: { hash?: string } }>;
  }>;
}

type SignedCall = ContractCall<unknown> & {
  toXdr: () => string;
  signAndSend: () => Promise<{ result: unknown; sendTransactionResponse?: { hash?: string } }>;
};

interface TicketContract {
  get_event: (args: { event_id: bigint }) => Promise<ContractCall<unknown>>;
  get_ticket: (args: { ticket_id: bigint }) => Promise<ContractCall<unknown>>;
  escrow_balance: (args: { event_id: bigint }) => Promise<ContractCall<unknown>>;
  event_status: (args: { event_id: bigint }) => Promise<ContractCall<unknown>>;
  is_organizer: (args: { organizer: string }) => Promise<ContractCall<unknown>>;
  mint_ticket: (
    args: { payer: string; owner: string; event_id: bigint; tier: number },
    opts?: { timeoutInSeconds?: number },
  ) => Promise<SignedCall>;
  create_event: (
    args: {
      organizer: string;
      capacity: number;
      price: bigint;
      max_transfers: number;
      resale_cap: bigint;
      splits: { recipient: string; bps: number }[];
      metadata_hash: Buffer | Uint8Array;
      ends_at: bigint;
      royalty_bps: number;
    },
    opts?: { timeoutInSeconds?: number },
  ) => Promise<SignedCall>;
  complete_event: (args: { caller: string; event_id: bigint }, opts?: { timeoutInSeconds?: number }) => Promise<SignedCall>;
  cancel_event: (args: { caller: string; event_id: bigint }, opts?: { timeoutInSeconds?: number }) => Promise<SignedCall>;
  release_payout: (args: { caller: string; event_id: bigint }, opts?: { timeoutInSeconds?: number }) => Promise<SignedCall>;
  set_payout_milestone: (
    args: { caller: string; event_id: bigint; min_checkins: number; partial_release_bps: number },
    opts?: { timeoutInSeconds?: number },
  ) => Promise<SignedCall>;
  claim_refund: (args: { owner: string; ticket_id: bigint }, opts?: { timeoutInSeconds?: number }) => Promise<SignedCall>;
  transfer_ticket: (
    args: { ticket_id: bigint; from: string; to: string; price: bigint },
    opts?: { timeoutInSeconds?: number },
  ) => Promise<SignedCall>;
}

const ticketSpecs = new Map<string, Promise<contract.Spec>>();
const usdcSpecs = new Map<string, Promise<contract.Spec>>();

function horizon(cfg: ChainConfig) {
  return new Horizon.Server(cfg.horizonUrl);
}

function rpcServer(cfg: ChainConfig) {
  return new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith("http://") });
}

function usdcAsset(cfg: ChainConfig) {
  return new Asset(cfg.usdcCode, cfg.usdcIssuer);
}

async function specFor(
  cache: Map<string, Promise<contract.Spec>>,
  cfg: ChainConfig,
  contractId: string,
): Promise<contract.Spec> {
  let pending = cache.get(contractId);
  if (!pending) {
    pending = contract.Client.from({
      contractId,
      rpcUrl: cfg.rpcUrl,
      networkPassphrase: cfg.networkPassphrase,
    }).then((client) => client.spec);
    cache.set(contractId, pending);
  }
  return pending;
}

function clientFor<T>(spec: contract.Spec, cfg: ChainConfig, contractId: string, publicKey?: string, signer?: Keypair): T {
  return new contract.Client(spec, {
    contractId,
    rpcUrl: cfg.rpcUrl,
    networkPassphrase: cfg.networkPassphrase,
    publicKey,
    ...(signer ? contract.basicNodeSigner(signer, cfg.networkPassphrase) : {}),
  }) as T;
}

/** Contract `Result` values unwrap to the success payload. */
export function unwrapResult<T>(result: unknown): T {
  if (result && typeof result === "object" && "unwrap" in result && typeof result.unwrap === "function") {
    return (result as { unwrap: () => T }).unwrap();
  }
  return result as T;
}

export function bytesToHex(value: unknown): string {
  if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => /^\d+$/.test(key));
    if (entries.length === 32) {
      const bytes = Buffer.alloc(32);
      for (const [key, byte] of entries) bytes[Number(key)] = Number(byte);
      return bytes.toString("hex");
    }
  }
  throw new Error("Could not read the event metadata hash");
}

export async function accountRecord(cfg: ChainConfig, publicKey: string) {
  try {
    return await horizon(cfg).loadAccount(publicKey);
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 404) return null;
    throw error;
  }
}

export function hasUsdcTrustline(account: Awaited<ReturnType<Horizon.Server["loadAccount"]>>, cfg: ChainConfig) {
  return account.balances.some(
    (balance) =>
      balance.asset_type !== "native" &&
      "asset_code" in balance &&
      balance.asset_code === cfg.usdcCode &&
      balance.asset_issuer === cfg.usdcIssuer,
  );
}

export async function usdcBalance(cfg: ChainConfig, publicKey: string): Promise<bigint> {
  const spec = await specFor(usdcSpecs, cfg, cfg.usdcContractId);
  const client = clientFor<UsdcContract>(spec, cfg, cfg.usdcContractId);
  try {
    const result = await client.balance({ id: publicKey });
    return BigInt(unwrapResult<bigint | number | string>(result.result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("#13") || message.includes("trustline")) return 0n;
    throw error;
  }
}

export async function readOnChainEvent(cfg: ChainConfig, eventId: bigint): Promise<OnChainEvent> {
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  const client = clientFor<TicketContract>(spec, cfg, cfg.ticketContractId);
  const result = await client.get_event({ event_id: eventId });
  const info = unwrapResult<{
    organizer: string;
    capacity: number;
    sold: number;
    checked_in?: number;
    max_transfers: number;
    resale_cap: bigint;
    sales_open: boolean;
    fee_bps: number;
    royalty_bps?: number;
    ends_at?: bigint | number;
    status?: unknown;
    payout_released?: boolean;
    partial_released?: boolean;
    min_checkins_partial?: number;
    partial_release_bps?: number;
    metadata_hash: unknown;
    splits: { recipient: string; bps: number }[];
    tiers: { price: bigint; capacity: number; sold: number }[];
  }>(result.result);
  return {
    organizer: info.organizer,
    capacity: info.capacity,
    sold: info.sold,
    checkedIn: Number(info.checked_in ?? 0),
    maxTransfers: info.max_transfers,
    resaleCap: BigInt(info.resale_cap),
    salesOpen: info.sales_open,
    feeBps: info.fee_bps,
    royaltyBps: Number(info.royalty_bps ?? 0),
    endsAt: BigInt(info.ends_at ?? 0),
    status: parseEventStatus(info.status),
    payoutReleased: Boolean(info.payout_released),
    partialReleased: Boolean(info.partial_released),
    minCheckinsPartial: Number(info.min_checkins_partial ?? 0),
    partialReleaseBps: Number(info.partial_release_bps ?? 0),
    metadataHash: bytesToHex(info.metadata_hash),
    splits: info.splits.map((split) => ({ recipient: split.recipient, bps: split.bps })),
    tiers: info.tiers.map((tier) => ({
      price: BigInt(tier.price),
      capacity: tier.capacity,
      sold: tier.sold,
    })),
  };
}

function parseEventStatus(value: unknown): OnChainEventStatus | undefined {
  if (value === "Live" || value === "Completed" || value === "Cancelled") return value;
  if (value && typeof value === "object" && "tag" in value) {
    const tag = (value as { tag: unknown }).tag;
    if (tag === "Live" || tag === "Completed" || tag === "Cancelled") return tag;
  }
  return undefined;
}

export async function readEscrowBalance(cfg: ChainConfig, eventId: bigint): Promise<bigint> {
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  const client = clientFor<TicketContract>(spec, cfg, cfg.ticketContractId);
  const result = await client.escrow_balance({ event_id: eventId });
  return BigInt(unwrapResult<bigint | number | string>(result.result));
}

export async function readEventStatus(cfg: ChainConfig, eventId: bigint): Promise<OnChainEventStatus | undefined> {
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  const client = clientFor<TicketContract>(spec, cfg, cfg.ticketContractId);
  const result = await client.event_status({ event_id: eventId });
  return parseEventStatus(unwrapResult(result.result));
}

export async function readOnChainTicket(cfg: ChainConfig, ticketId: bigint) {
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  const client = clientFor<TicketContract>(spec, cfg, cfg.ticketContractId);
  const result = await client.get_ticket({ ticket_id: ticketId });
  return unwrapResult<{
    event_id: bigint;
    tier: number;
    owner: string;
    transfers?: number;
    checked_in?: boolean;
    paid?: bigint;
    refunded?: boolean;
  }>(result.result);
}

export async function readIsOrganizer(cfg: ChainConfig, organizer: string): Promise<boolean> {
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  const client = clientFor<TicketContract>(spec, cfg, cfg.ticketContractId);
  const result = await client.is_organizer({ organizer });
  return Boolean(unwrapResult(result.result));
}

/** Create the account (if needed) and add the USDC trustline. Each transaction has one signer. */
export async function activateAccount(cfg: ChainConfig, platform: Keypair, account: Keypair): Promise<string | null> {
  let existing = await accountRecord(cfg, account.publicKey());
  let hash: string | null = null;
  if (!existing) {
    const source = await horizon(cfg).loadAccount(platform.publicKey());
    const create = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase })
      .addOperation(Operation.createAccount({ destination: account.publicKey(), startingBalance: "5" }))
      .setTimeout(180)
      .build();
    create.sign(platform);
    hash = (await horizon(cfg).submitTransaction(create)).hash;
    existing = await accountRecord(cfg, account.publicKey());
  }
  if (existing && !hasUsdcTrustline(existing, cfg)) {
    const buyer = await horizon(cfg).loadAccount(account.publicKey());
    const trust = new TransactionBuilder(buyer, { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase })
      .addOperation(Operation.changeTrust({ asset: usdcAsset(cfg) }))
      .setTimeout(180)
      .build();
    trust.sign(account);
    hash = (await horizon(cfg).submitTransaction(trust)).hash;
  }
  return hash;
}

export async function buildPaymentXdr(
  cfg: ChainConfig,
  from: string,
  input: { destination: string; amount: string; memo?: string; memoType?: string },
): Promise<string> {
  const source = await horizon(cfg).loadAccount(from);
  const builder = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase }).addOperation(
    Operation.payment({
      destination: input.destination,
      asset: usdcAsset(cfg),
      amount: input.amount,
    }),
  );
  if (input.memo) {
    const type = (input.memoType ?? "text").toLowerCase();
    if (type === "id") builder.addMemo(Memo.id(input.memo));
    else if (type === "hash") builder.addMemo(Memo.hash(Buffer.from(input.memo, "hex").toString("hex")));
    else builder.addMemo(Memo.text(input.memo.slice(0, 28)));
  }
  return builder.setTimeout(180).build().toXDR();
}

export async function submitSignedPayment(cfg: ChainConfig, signedXdr: string, from: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, cfg.networkPassphrase) as Transaction;
  if (tx.source !== from) throw new Error("The payout was signed by a different account.");
  const sent = await horizon(cfg).submitTransaction(tx);
  return sent.hash;
}

export async function sendPayment(
  cfg: ChainConfig,
  signer: Keypair,
  input: { destination: string; amount: string; memo?: string; memoType?: string },
): Promise<string> {
  const xdr = await buildPaymentXdr(cfg, signer.publicKey(), input);
  const tx = TransactionBuilder.fromXDR(xdr, cfg.networkPassphrase) as Transaction;
  tx.sign(signer);
  return submitSignedPayment(cfg, tx.toXDR(), signer.publicKey());
}

export async function buildTrustlineXdr(cfg: ChainConfig, publicKey: string): Promise<string> {
  const source = await horizon(cfg).loadAccount(publicKey);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: cfg.networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: usdcAsset(cfg) }))
    .setTimeout(180)
    .build();
  return tx.toXDR();
}

export async function submitTrustline(cfg: ChainConfig, signedXdr: string, publicKey: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, cfg.networkPassphrase) as Transaction;
  if (tx.source !== publicKey) throw new Error("The trustline was signed by a different account.");
  const op = tx.operations[0];
  const line = op && op.type === "changeTrust" ? op.line : null;
  if (!line || !("code" in line) || line.code !== cfg.usdcCode || line.issuer !== cfg.usdcIssuer) {
    throw new Error("That transaction is not a USDC trustline.");
  }
  const sent = await horizon(cfg).submitTransaction(tx);
  return sent.hash;
}

export async function buildMintTicketXdr(
  cfg: ChainConfig,
  sourcePublicKey: string,
  args: { payer: string; owner: string; eventId: bigint; tier: number },
): Promise<string> {
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  const client = clientFor<TicketContract>(spec, cfg, cfg.ticketContractId, sourcePublicKey);
  const tx = await client.mint_ticket(
    { payer: args.payer, owner: args.owner, event_id: args.eventId, tier: args.tier },
    { timeoutInSeconds: 180 },
  );
  return tx.toXdr();
}

export async function sendMintTicket(
  cfg: ChainConfig,
  signer: Keypair,
  args: { payer: string; owner: string; eventId: bigint; tier: number },
): Promise<{ hash: string; ticketId: bigint }> {
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  const client = clientFor<TicketContract>(spec, cfg, cfg.ticketContractId, signer.publicKey(), signer);
  const tx = await client.mint_ticket(
    { payer: args.payer, owner: args.owner, event_id: args.eventId, tier: args.tier },
    { timeoutInSeconds: 180 },
  );
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("The network did not return a transaction hash.");
  const ticketId = BigInt(unwrapResult<bigint | number>(sent.result));
  return { hash, ticketId };
}

export async function submitSignedMint(
  cfg: ChainConfig,
  signedXdr: string,
  expected: { payer: string; eventId: bigint },
): Promise<{ hash: string; ticketId: bigint }> {
  const tx = TransactionBuilder.fromXDR(signedXdr, cfg.networkPassphrase) as Transaction;
  if (tx.source !== expected.payer) throw new Error("The purchase was signed by a different account.");
  const op = tx.operations[0];
  if (!op || op.type !== "invokeHostFunction") throw new Error("That transaction is not a ticket purchase.");

  const server = rpcServer(cfg);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error("The network rejected the purchase.");
  const hash = sent.hash;
  const done = await waitForTransaction(server, hash);
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  if (!done.returnValue) throw new Error("The purchase did not return a ticket.");
  const ticketId = BigInt(unwrapResult<bigint | number>(spec.funcResToNative("mint_ticket", done.returnValue)));
  const ticket = await readOnChainTicket(cfg, ticketId);
  if (BigInt(ticket.event_id) !== expected.eventId) throw new Error("The ticket is for a different event.");
  return { hash, ticketId };
}

async function waitForTransaction(server: rpc.Server, hash: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = await server.getTransaction(hash);
    if (found.status === rpc.Api.GetTransactionStatus.SUCCESS) return found;
    if (found.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error("The transaction failed on the network.");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("The transaction is still pending. Check again in a moment.");
}

async function ticketClient(cfg: ChainConfig, publicKey?: string, signer?: Keypair): Promise<TicketContract> {
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  return clientFor<TicketContract>(spec, cfg, cfg.ticketContractId, publicKey, signer);
}

export function signXdr(cfg: ChainConfig, xdr: string, signer: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, cfg.networkPassphrase) as Transaction;
  tx.sign(signer);
  return tx.toXDR();
}

export async function submitSignedInvoke(
  cfg: ChainConfig,
  signedXdr: string,
  expectedSource: string,
  method: string,
): Promise<{ hash: string; native: unknown }> {
  const tx = TransactionBuilder.fromXDR(signedXdr, cfg.networkPassphrase) as Transaction;
  if (tx.source !== expectedSource) throw new Error("That transaction was signed by a different account.");
  const op = tx.operations[0];
  if (!op || op.type !== "invokeHostFunction") throw new Error("That transaction is not a contract call.");
  const server = rpcServer(cfg);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error("The network rejected the transaction.");
  const hash = sent.hash;
  const done = await waitForTransaction(server, hash);
  const spec = await specFor(ticketSpecs, cfg, cfg.ticketContractId);
  const native = done.returnValue ? spec.funcResToNative(method, done.returnValue) : undefined;
  return { hash, native: native === undefined ? undefined : unwrapResult(native) };
}

export async function buildCreateEventXdr(
  cfg: ChainConfig,
  source: string,
  args: {
    organizer: string;
    capacity: number;
    price: bigint;
    maxTransfers: number;
    resaleCap: bigint;
    splits: { recipient: string; bps: number }[];
    metadataHash: Uint8Array;
    endsAt: bigint;
    royaltyBps: number;
  },
): Promise<string> {
  const client = await ticketClient(cfg, source);
  const tx = await client.create_event(
    {
      organizer: args.organizer,
      capacity: args.capacity,
      price: args.price,
      max_transfers: args.maxTransfers,
      resale_cap: args.resaleCap,
      splits: args.splits,
      metadata_hash: Buffer.from(args.metadataHash),
      ends_at: args.endsAt,
      royalty_bps: args.royaltyBps,
    },
    { timeoutInSeconds: 180 },
  );
  return tx.toXdr();
}

export async function sendCreateEvent(
  cfg: ChainConfig,
  signer: Keypair,
  args: Parameters<typeof buildCreateEventXdr>[2],
): Promise<{ hash: string; eventId: bigint }> {
  const client = await ticketClient(cfg, signer.publicKey(), signer);
  const tx = await client.create_event(
    {
      organizer: args.organizer,
      capacity: args.capacity,
      price: args.price,
      max_transfers: args.maxTransfers,
      resale_cap: args.resaleCap,
      splits: args.splits,
      metadata_hash: Buffer.from(args.metadataHash),
      ends_at: args.endsAt,
      royalty_bps: args.royaltyBps,
    },
    { timeoutInSeconds: 180 },
  );
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("The network did not return a transaction hash.");
  return { hash, eventId: BigInt(unwrapResult<bigint | number>(sent.result)) };
}

export async function buildCompleteEventXdr(cfg: ChainConfig, caller: string, eventId: bigint): Promise<string> {
  const client = await ticketClient(cfg, caller);
  return (await client.complete_event({ caller, event_id: eventId }, { timeoutInSeconds: 180 })).toXdr();
}

export async function sendCompleteEvent(cfg: ChainConfig, signer: Keypair, eventId: bigint): Promise<string> {
  const client = await ticketClient(cfg, signer.publicKey(), signer);
  const sent = await (await client.complete_event({ caller: signer.publicKey(), event_id: eventId }, { timeoutInSeconds: 180 })).signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("The network did not return a transaction hash.");
  return hash;
}

export async function buildCancelEventXdr(cfg: ChainConfig, caller: string, eventId: bigint): Promise<string> {
  const client = await ticketClient(cfg, caller);
  return (await client.cancel_event({ caller, event_id: eventId }, { timeoutInSeconds: 180 })).toXdr();
}

export async function sendCancelEvent(cfg: ChainConfig, signer: Keypair, eventId: bigint): Promise<string> {
  const client = await ticketClient(cfg, signer.publicKey(), signer);
  const sent = await (await client.cancel_event({ caller: signer.publicKey(), event_id: eventId }, { timeoutInSeconds: 180 })).signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("The network did not return a transaction hash.");
  return hash;
}

export async function buildReleasePayoutXdr(cfg: ChainConfig, caller: string, eventId: bigint): Promise<string> {
  const client = await ticketClient(cfg, caller);
  return (await client.release_payout({ caller, event_id: eventId }, { timeoutInSeconds: 180 })).toXdr();
}

export async function sendReleasePayout(cfg: ChainConfig, signer: Keypair, eventId: bigint): Promise<{ hash: string; amount: bigint }> {
  const client = await ticketClient(cfg, signer.publicKey(), signer);
  const sent = await (await client.release_payout({ caller: signer.publicKey(), event_id: eventId }, { timeoutInSeconds: 180 })).signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("The network did not return a transaction hash.");
  return { hash, amount: BigInt(unwrapResult<bigint | number>(sent.result)) };
}

export async function buildSetMilestoneXdr(
  cfg: ChainConfig,
  caller: string,
  eventId: bigint,
  minCheckins: number,
  partialReleaseBps: number,
): Promise<string> {
  const client = await ticketClient(cfg, caller);
  return (
    await client.set_payout_milestone(
      { caller, event_id: eventId, min_checkins: minCheckins, partial_release_bps: partialReleaseBps },
      { timeoutInSeconds: 180 },
    )
  ).toXdr();
}

export async function sendSetMilestone(
  cfg: ChainConfig,
  signer: Keypair,
  eventId: bigint,
  minCheckins: number,
  partialReleaseBps: number,
): Promise<string> {
  const client = await ticketClient(cfg, signer.publicKey(), signer);
  const sent = await (
    await client.set_payout_milestone(
      {
        caller: signer.publicKey(),
        event_id: eventId,
        min_checkins: minCheckins,
        partial_release_bps: partialReleaseBps,
      },
      { timeoutInSeconds: 180 },
    )
  ).signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("The network did not return a transaction hash.");
  return hash;
}

export async function buildClaimRefundXdr(cfg: ChainConfig, owner: string, ticketId: bigint): Promise<string> {
  const client = await ticketClient(cfg, owner);
  return (await client.claim_refund({ owner, ticket_id: ticketId }, { timeoutInSeconds: 180 })).toXdr();
}

export async function sendClaimRefund(cfg: ChainConfig, signer: Keypair, ticketId: bigint): Promise<{ hash: string; amount: bigint }> {
  const client = await ticketClient(cfg, signer.publicKey(), signer);
  const sent = await (await client.claim_refund({ owner: signer.publicKey(), ticket_id: ticketId }, { timeoutInSeconds: 180 })).signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("The network did not return a transaction hash.");
  return { hash, amount: BigInt(unwrapResult<bigint | number>(sent.result)) };
}

export async function buildTransferTicketXdr(
  cfg: ChainConfig,
  source: string,
  args: { ticketId: bigint; from: string; to: string; price: bigint },
): Promise<string> {
  const client = await ticketClient(cfg, source);
  return (
    await client.transfer_ticket(
      { ticket_id: args.ticketId, from: args.from, to: args.to, price: args.price },
      { timeoutInSeconds: 180 },
    )
  ).toXdr();
}

export async function sendTransferTicket(
  cfg: ChainConfig,
  signer: Keypair,
  args: { ticketId: bigint; from: string; to: string; price: bigint },
): Promise<string> {
  const client = await ticketClient(cfg, signer.publicKey(), signer);
  const sent = await (
    await client.transfer_ticket(
      { ticket_id: args.ticketId, from: args.from, to: args.to, price: args.price },
      { timeoutInSeconds: 180 },
    )
  ).signAndSend();
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error("The network did not return a transaction hash.");
  return hash;
}
