import EventEmitter from "eventemitter3";
import { PublicKey, Transaction } from "@solana/web3.js";

export enum WalletEvent {
  CONNECT = "connect",
  DISCONNECT = "disconnect",
  SIGNED = "signed",
}

/**
 * Abstract wallet implementation. Any wallet connection,
 * e.g. browser extension, hardware wallet, web wallet etc,
 * is a separate implementation of this.
 */
export abstract class Wallet extends EventEmitter {
  private network: string;

  protected constructor(network: string) {
    super();
    this.network = network;
  }

  abstract get pubkey(): PublicKey;

  abstract disconnect(): void;

  /**
   * Sign the transaction, and emit a "signed" event
   * @param transaction
   */
  sign(transaction: Transaction): Promise<Transaction> {
    const signedTransaction = this.signTransaction(transaction);
    this.emit(WalletEvent.SIGNED, { transaction: signedTransaction });

    return signedTransaction;
  }

  /**
   * Delegate to the underlying implementation to sign the transaction
   * @param transaction
   * @protected
   */
  protected abstract signTransaction(
    transaction: Transaction
  ): Promise<Transaction>;
}
