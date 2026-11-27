/**
 * Backend-neutral wallet model. Screens and WalletContext only talk to these
 * types, never to a specific node API, so backends (LND REST, NWC, LNDHub,
 * later an embedded LND) stay interchangeable.
 */

export type PaymentDirection = 'in' | 'out';
export type PaymentState = 'pending' | 'complete' | 'failed';
export type PaymentRail = 'lightning' | 'onchain' | 'unknown';

export type WalletPayment = {
  id: string;
  direction: PaymentDirection;
  state: PaymentState;
  rail: PaymentRail;
  amountSats: bigint;
  feeSats: bigint;
  /** Unix timestamp in seconds. */
  timestamp: number;
  description?: string;
  /** Details for the payment screen; whatever the backend knows. */
  paymentHash?: string;
  preimage?: string;
  invoice?: string;
  txid?: string;
  confirmations?: number;
  /** On-chain: receiving addresses of the transaction. */
  addresses?: string[];
};

/** Where the balance sits; only backends that run a full node report it. */
export type BalanceBreakdown = {
  lightningSats: bigint;
  onchainSats: bigint;
  /** On-chain funds waiting for confirmation (not included in balanceSats). */
  onchainPendingSats: bigint;
};

export type WalletSnapshot = {
  balanceSats: bigint;
  breakdown: BalanceBreakdown | null;
  payments: WalletPayment[];
  lastSyncedAt: Date | null;
};

export type Invoice = {
  invoice: string;
  /** Fee the backend charges for receiving, if any. */
  feeSats: bigint;
};

export type QuoteKind = 'lightning' | 'onchain';

/** Extra confirm-screen row; amounts in sats are formatted in the user's unit. */
export type QuoteDetail =
  | { key: 'network' | 'validUntil' | 'feeRate'; text: string }
  | { key: 'transferFee' | 'maxFee' | 'estimatedOut'; sats: bigint };

export type SendResult = {
  state: PaymentState;
  /** On-chain transaction id, for on-chain sends. */
  txid?: string;
};

/** A reviewed payment. `confirm()` actually sends it. */
export type SendQuote = {
  kind: QuoteKind;
  destination: string;
  amountSats: bigint;
  /** undefined = the backend cannot tell before sending. */
  feeSats: bigint | undefined;
  /** feeSats is an estimate (on-chain: depends on the final transaction size). */
  feeEstimated?: boolean;
  /** Extra rows for the confirm screen. */
  details?: QuoteDetail[];
  confirm: () => Promise<SendResult>;
};

export type SendTarget = 'lightning' | 'bitcoin';

export type OnchainSendRequest = {
  address: string;
  /** Coin control: spend only these outpoints ("txid:index"). */
  outpoints?: string[];
  /** Ignored when sendAll is set. */
  amountSats?: bigint;
  /** Sweep the whole confirmed on-chain balance (no change output). */
  sendAll: boolean;
  satPerVbyte: number;
  label?: string;
};

export type BackendInfo = {
  /** Shown in settings, e.g. "lnd // my node" or "nwc // alby". */
  label: string;
  /** Network badge on the home screen; null if the backend does not report it. */
  network: string | null;
  /** What the send screen accepts; drives the destination hint. */
  sendTargets: SendTarget[];
  onchainReceive: boolean;
};

export type ChannelState =
  | 'active'
  | 'inactive' // open, but the peer is offline
  | 'opening' // funding transaction not yet confirmed
  | 'closing' // cooperative close in progress
  | 'force_closing'; // funds time-locked until maturity

export type Channel = {
  /** Funding outpoint "txid:index"; stable across states. */
  channelPoint: string;
  remotePubkey: string;
  alias?: string;
  state: ChannelState;
  capacitySats: bigint;
  localSats: bigint;
  remoteSats: bigint;
  private: boolean;
  /** We opened (and paid for) the channel. */
  initiator?: boolean;
  /** Short channel id (LND chan_id), for routing hints such as rebalancing. */
  chanId?: string;
  /** Force close: funds stuck until then. */
  limboSats?: bigint;
  maturityBlocks?: number;
};

/** On-chain fee rate suggestion from the node's estimator. */
export type FeeEstimate = { speed: 'fast' | 'medium' | 'slow'; targetBlocks: number; satPerVbyte: number };

export type OpenChannelRequest = {
  /** "pubkey@host:port", or just the pubkey if the node already knows the peer. */
  nodeUri: string;
  amountSats: bigint;
  satPerVbyte: number;
  private: boolean;
};

export type CloseChannelRequest = {
  channelPoint: string;
  force: boolean;
  /** Ignored for force closes (the commitment transaction is pre-signed). */
  satPerVbyte?: number;
};

/** Our routing policy on a channel. */
export type ChannelPolicy = { baseFeeMsat: bigint; feePpm: number; timeLockDelta?: number };

export type RebalanceRequest = {
  /** Channel with too much local balance (the payment leaves through it). */
  outChannelPoint: string;
  /** Channel with too little local balance (the payment comes back through it). */
  inChannelPoint: string;
  amountSats: bigint;
  maxFeeSats: bigint;
};

/** Channel management; only present on backends that control a node (LND). */
export interface ChannelFeatures {
  list(): Promise<Channel[]>;
  open(request: OpenChannelRequest): Promise<{ channelPoint: string }>;
  /** Resolves once the closing transaction is broadcast. */
  close(request: CloseChannelRequest): Promise<{ closingTxid: string | null }>;
  /** Our fee policies by channel point. */
  policies?(): Promise<Record<string, ChannelPolicy>>;
  updatePolicy?(channelPoint: string, policy: ChannelPolicy): Promise<void>;
  /** Circular payment to move liquidity between two own channels. */
  rebalance?(request: RebalanceRequest): Promise<{ feeSats: bigint }>;
}

export type Utxo = {
  /** "txid:index" */
  outpoint: string;
  amountSats: bigint;
  address: string;
  confirmations: number;
};

export type InvoiceStatus = 'open' | 'paid' | 'expired' | 'canceled';

export type HistoryPage = { payments: WalletPayment[]; cursor: string | null };

export type NodeStatus = {
  alias: string;
  pubkey: string;
  version: string;
  blockHeight: number;
  syncedToChain: boolean;
  syncedToGraph: boolean;
  activeChannels: number;
  inactiveChannels: number;
  pendingChannels: number;
  peers: number;
  /** "pubkey@host:port" addresses the node announces. */
  uris: string[];
};

/** Routing fees earned (LND fee report). */
export type RoutingSummary = {
  daySats: bigint;
  weekSats: bigint;
  monthSats: bigint;
  channelCount: number;
  averageFeePpm: number;
};

export type ForwardEvent = {
  timestamp: number;
  amountInSats: bigint;
  amountOutSats: bigint;
  feeMsat: bigint;
  /** Peer alias or channel id. */
  channelIn: string;
  channelOut: string;
  /** Details for the forward's detail view. */
  chanIdIn?: string;
  chanIdOut?: string;
  amountInMsat?: bigint;
  amountOutMsat?: bigint;
};

/** Node dashboard; only on backends that run a routing node (LND). */
export interface RoutingFeatures {
  status(): Promise<NodeStatus>;
  summary(): Promise<RoutingSummary>;
  forwards(days: number): Promise<ForwardEvent[]>;
}

export interface WalletBackend {
  readonly info: BackendInfo;
  getSnapshot(): Promise<WalletSnapshot>;
  createInvoice(request: { amountSats?: bigint; description: string }): Promise<Invoice>;
  /** Only available when `info.onchainReceive` is true. */
  getOnchainAddress(fresh: boolean): Promise<string>;
  /** Present on backends that control a node. */
  readonly channels?: ChannelFeatures;
  /** Node dashboard: status, routing fees, forwards. */
  readonly routing?: RoutingFeatures;
  /** On-chain fee suggestions; only where the backend can estimate. */
  estimateFees?(): Promise<FeeEstimate[]>;
  /** Lightning invoice payment. */
  prepareSend(request: { destination: string; amountSats?: bigint }): Promise<SendQuote>;
  /** On-chain payment; only where `info.sendTargets` includes 'bitcoin'. */
  prepareOnchainSend?(request: OnchainSendRequest): Promise<SendQuote>;
  /** Spendable on-chain coins, for coin control. */
  listUtxos?(): Promise<Utxo[]>;
  /** Speeds up an unconfirmed own transaction (CPFP via the node's sweeper). */
  bumpOnchainFee?(txid: string, satPerVbyte: number): Promise<void>;
  /** Older history, page by page. Start with no cursor; a null cursor means the end. */
  history?(cursor: string | null): Promise<HistoryPage>;
  /** State of an invoice created by this backend (payment hash in hex). */
  lookupInvoice?(paymentHash: string): Promise<InvoiceStatus>;
  /** Calls `onChange` whenever balance or history may have changed. Returns an unsubscribe function. */
  subscribe(onChange: () => void): Promise<() => Promise<void> | void>;
  disconnect(): Promise<void>;
}
