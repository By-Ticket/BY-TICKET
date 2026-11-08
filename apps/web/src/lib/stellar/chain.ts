import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
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
  maxTransfers: number;
  resaleCap: bigint;
  salesOpen: boolean;
  feeBps: number;
  royaltyBps?: number;
  endsAt?: bigint;
  status?: OnChainEventStatus;
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

interface TicketContract {
  get_event: (args: { event_id: bigint }) => Promise<ContractCall<unknown>>;
  get_ticket: (args: { ticket_id: bigint }) => Promise<ContractCall<unknown>>;
  escrow_balance: (args: { event_id: bigint }) => Promise<ContractCall<unknown>>;
  event_status: (args: { event_id: bigint }) => Promise<ContractCall<unknown>>;
  mint_ticket: (
    args: { payer: string; owner: string; event_id: bigint; tier: number },
    opts?: { timeoutInSeconds?: number },
  ) => Promise<ContractCall<unknown> & {
    toXdr: () => string;
    signAndSend: () => Promise<{ result: unknown; sendTransactionResponse?: { hash?: string } }>;
  }>;
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
    max_transfers: number;
    resale_cap: bigint;
    sales_open: boolean;
    fee_bps: number;
    royalty_bps?: number;
    ends_at?: bigint | number;
    status?: unknown;
    metadata_hash: unknown;
    splits: { recipient: string; bps: number }[];
    tiers: { price: bigint; capacity: number; sold: number }[];
  }>(result.result);
  return {
    organizer: info.organizer,
    capacity: info.capacity,
    sold: info.sold,
    maxTransfers: info.max_transfers,
    resaleCap: BigInt(info.resale_cap),
    salesOpen: info.sales_open,
    feeBps: info.fee_bps,
    royaltyBps: info.royalty_bps,
    endsAt: info.ends_at === undefined ? undefined : BigInt(info.ends_at),
    status: parseEventStatus(info.status),
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
    paid?: bigint;
    refunded?: boolean;
  }>(result.result);
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
    if (found.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error("The purchase failed on the network.");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("The purchase is still pending. Check again in a moment.");
}
