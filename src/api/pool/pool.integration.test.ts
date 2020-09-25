import { PublicKey } from "@solana/web3.js";
import * as WalletAPI from "../wallet/";
import { WalletType } from "../wallet/";
import { Wallet } from "../wallet/Wallet";
import { TokenAccount } from "../token/TokenAccount";
import { createToken } from "../../../test/utils/token";
import { airdropTo } from "../../../test/utils/account";
import { getConnection } from "../connection";
import { ExtendedCluster } from "../../utils/types";
import { APIFactory as TokenAPIFactory } from "../token";
import { Pool } from "./Pool";
import {
  APIFactory as PoolAPIFactory,
  DepositParameters,
  SwapParameters,
  WithdrawalParameters,
} from "./index";

// Increase timeout for tests that send transactions
jest.setTimeout(240000);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require("./pool.config.json");

const localnetPoolConfig = config.localnet;

// These depends on how the pool in config.localnet.pools[0] was initialised
// In particular, how many tokens of A and B were added.
const EXPECTED_POOL_LIQUIDITY = 1000;
const EXPECTED_POOL_RATE = 2;
const FEE_NUMERATOR = 1;
const FEE_DENOMINATOR = 4;

const CLUSTER: ExtendedCluster = "localnet";
const API = PoolAPIFactory(CLUSTER);
const tokenAPI = TokenAPIFactory(CLUSTER);

const updateTokenAccount = (tokenAccount: TokenAccount) =>
  tokenAPI.tokenAccountInfo(tokenAccount.address) as Promise<TokenAccount>;

const expectPoolAmounts = async (
  pool: Pool,
  tokenAAmount: number,
  tokenBAmount: number
): Promise<void> => {
  const updatedPool = await API.getPool(pool.address);

  console.log(updatedPool.toString());

  // the liquidity of the pool is always equal to the tokenA amount
  expect(updatedPool.getLiquidity()).toEqual(tokenAAmount);
  expect(updatedPool.tokenA.balance).toEqual(tokenAAmount);
  expect(updatedPool.tokenB.balance).toEqual(tokenBAmount);

  const impliedRate = tokenBAmount / tokenAAmount;
  expect(updatedPool.getRate()).toEqual(impliedRate);
};

const expectTokenAccountBalance = async (
  tokenAccount: TokenAccount,
  expectedBalance: number
) => {
  const updatedTokenAccount = await updateTokenAccount(tokenAccount);

  expect(updatedTokenAccount.balance).toEqual(expectedBalance);
};

describe("api/pool integration test", () => {
  let pool: Pool;
  let loadedPools: Array<Pool>;

  let wallet: Wallet;
  let donorAccountA: TokenAccount;
  let donorAccountB: TokenAccount;

  const getPoolTokenAccount = async () => {
    const walletAccounts = await tokenAPI.getAccountsForToken(
      wallet,
      pool.poolToken
    );

    return walletAccounts[0];
  };

  beforeAll(async () => {
    wallet = await WalletAPI.connect(CLUSTER, WalletType.LOCAL);

    console.log("Airdropping to the wallet");
    // airdrop multiple times so as not to run out of funds.
    // single large airdrops appear to fail
    await airdropTo(getConnection(CLUSTER), wallet.pubkey);
    await airdropTo(getConnection(CLUSTER), wallet.pubkey);
    await airdropTo(getConnection(CLUSTER), wallet.pubkey);
  });

  describe("createPool", () => {
    beforeAll(async () => {
      console.log("Creating Tokens");
      [, donorAccountA] = await createToken({ sendTokens: true });
      [, donorAccountB] = await createToken({ sendTokens: true });

      console.log("Created tokens:");
      console.log(donorAccountA.toString());
      console.log(donorAccountB.toString());
    });

    it("should create a pool", async () => {
      pool = await API.createPool({
        donorAccountA,
        donorAccountB,
        feeNumerator: FEE_NUMERATOR,
        feeDenominator: FEE_DENOMINATOR,
        wallet,
        tokenAAmount: EXPECTED_POOL_LIQUIDITY,
        tokenBAmount: EXPECTED_POOL_LIQUIDITY * EXPECTED_POOL_RATE,
      });

      console.log("pool");
      console.log(pool.toString());

      expect(pool.getLiquidity()).toEqual(EXPECTED_POOL_LIQUIDITY);

      // the wallet was awarded pool tokens
      const poolTokenAccount = await getPoolTokenAccount();
      expect(poolTokenAccount.balance).toEqual(EXPECTED_POOL_LIQUIDITY);
    });
  });

  describe("getPools", () => {
    it("should load all pools", async () => {
      loadedPools = await API.getPools(true);

      expect(loadedPools).toHaveLength(1);
      expect(loadedPools[0]).toMatchObject({
        address: new PublicKey(localnetPoolConfig.pools[0]),
      });
    });
  });

  describe("with loaded pools", () => {
    let loadedPool: Pool;

    beforeAll(async () => {
      loadedPool = loadedPools[0];
    });

    it("should get the liquidity of a pool", () => {
      const liquidity = loadedPool.getLiquidity();

      expect(liquidity).toEqual(EXPECTED_POOL_LIQUIDITY);
    });

    it("should get the rate of a pool", () => {
      const liquidity = loadedPool.getRate();

      expect(liquidity).toEqual(EXPECTED_POOL_RATE);
    });

    it("should generate a string summary", () => {
      const summary = loadedPool.toString();

      // these values are correct for the balances as long as the
      // rate is a simple Constant Product Function i.e. Token B / Token A
      expect(summary).toMatch("Balance: " + EXPECTED_POOL_LIQUIDITY);
      expect(summary).toMatch(
        "Balance: " + EXPECTED_POOL_LIQUIDITY * EXPECTED_POOL_RATE
      );
    });
  });

  describe("operations", () => {
    let poolLiquidity = EXPECTED_POOL_LIQUIDITY;
    let poolTokenAccount: TokenAccount;

    beforeEach(async () => {
      // update the donor accounts in order to get the latest balances
      donorAccountA = await updateTokenAccount(donorAccountA);
      donorAccountB = await updateTokenAccount(donorAccountB);

      poolTokenAccount = await getPoolTokenAccount();
    });

    describe("deposit", () => {
      const amountToDeposit = 10; // in terms of token A

      it("should grant the wallet pool tokens", async () => {
        const depositParameters: DepositParameters = {
          fromAAccount: donorAccountA,
          fromAAmount: amountToDeposit,
          fromBAccount: donorAccountB,
          poolTokenAccount,
          pool,
          wallet,
        };

        await API.deposit(depositParameters);

        // the amount of liquidity has gone up as more tokenA has been added
        poolLiquidity = poolLiquidity + amountToDeposit;
        await expectPoolAmounts(
          pool,
          poolLiquidity,
          poolLiquidity * EXPECTED_POOL_RATE
        );

        // the user received the same amount of pool tokens as the amount they deposited (in token A)
        // since we are sending all transactions from the wallet, the pool tokens are all going to the
        // same account, the pool token account balance matches the liquidity at all times
        poolTokenAccount = await updateTokenAccount(poolTokenAccount);
        expect(poolTokenAccount.balance).toEqual(poolLiquidity);
      });
    });

    describe("withdraw", () => {
      const amountToWithdraw = 10; // in terms of token A

      it("should exchange the pool tokens for A & B", async () => {
        const withdrawalParameters: WithdrawalParameters = {
          fromPoolTokenAccount: poolTokenAccount,
          fromPoolTokenAmount: amountToWithdraw,
          toAAccount: donorAccountA,
          toBAccount: donorAccountB,
          pool,
          wallet,
        };

        await API.withdraw(withdrawalParameters);

        // the amount of liquidity has gone down as tokenA has been removed
        poolLiquidity = poolLiquidity - amountToWithdraw;
        await expectPoolAmounts(
          pool,
          poolLiquidity,
          poolLiquidity * EXPECTED_POOL_RATE
        );

        // since we are sending all transactions from the wallet, the pool tokens are all going to the
        // same account, the pool token account balance matches the liquidity at all times
        poolTokenAccount = await updateTokenAccount(poolTokenAccount);
        expect(poolTokenAccount.balance).toEqual(poolLiquidity);
      });
    });

    describe("swap", () => {
      const amountToSwap = 5; // in terms of token A

      it("should create a swap transaction - A->B", async () => {
        const expectedTokenBAmount = 8; // (new invariant / new A) - fees
        const expectedTokenBLiquidityPostSwap = 1992; // (new invariant / new A)

        const swapParameters: SwapParameters = {
          fromAccount: donorAccountA,
          fromAmount: amountToSwap,
          pool,
          toAccount: donorAccountB,
          wallet,
        };

        await API.swap(swapParameters);

        // the amount of liquidity has gone up as more tokenA has been added
        poolLiquidity = poolLiquidity + amountToSwap;
        await expectPoolAmounts(
          pool,
          poolLiquidity,
          expectedTokenBLiquidityPostSwap
        );

        const expectedTokenABalance = donorAccountA.balance - amountToSwap;
        const expectedTokenBBalance =
          donorAccountB.balance + expectedTokenBAmount;
        await expectTokenAccountBalance(donorAccountA, expectedTokenABalance);
        await expectTokenAccountBalance(donorAccountB, expectedTokenBBalance);
      });

      it("should create a reverse swap transaction - B->A", async () => {
        const expectedTokenAAmount = 3; // (new invariant / new B ) - fees
        const expectedTokenBLiquidityPostSwap = 1997; // previous liquidity + amountToSwap

        const swapParameters: SwapParameters = {
          fromAccount: donorAccountB,
          fromAmount: amountToSwap,
          pool,
          toAccount: donorAccountA,
          wallet,
        };

        await API.swap(swapParameters);

        // the amount of liquidity has gone down as tokenA has been removed
        poolLiquidity = poolLiquidity - expectedTokenAAmount;
        await expectPoolAmounts(
          pool,
          poolLiquidity,
          expectedTokenBLiquidityPostSwap
        );

        const expectedTokenABalance =
          donorAccountA.balance + expectedTokenAAmount;
        const expectedTokenBBalance = donorAccountB.balance - amountToSwap;
        await expectTokenAccountBalance(donorAccountA, expectedTokenABalance);
        await expectTokenAccountBalance(donorAccountB, expectedTokenBBalance);
      });
    });
  });
});