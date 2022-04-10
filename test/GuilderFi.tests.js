const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const clc = require("cli-color");

const DEAD = "0x000000000000000000000000000000000000dEaD";
const DEBUG = true;
const TOKEN_NAME = "GuilderFi";
const DECIMALS = 18;

let token;
let dexRouter;
let dexRouterAddress;
let dexFactory;
let dexPair;
let dexPairAddress;

let liquidityAddress;
let treasuryAddress;
let lrfAddress;
let burnAddress;

let ownerAccount;
let treasuryAccount;
let lrfAccount;
let liqudityAccount;
let account1;
let account2;
let account3;
let account4;

function addZeroes(num, zeroes) {
  return BigNumber.from(num).mul(BigNumber.from(10).pow(zeroes));
}

function print(msg) {
  if (DEBUG) console.log(clc.xterm(8)("      " + msg));
}

async function transferTokens(from, to, amount) {
  const transaction = await token.connect(from).transfer(to.address, amount);
  await transaction.wait();
}

function calculateInitialLP(tokenA, tokenB) {
  // https://www.reddit.com/r/UniSwap/comments/i49dmk/how_are_lp_token_amounts_calculated/

  const MINIMUM_LIQUIDITY = 1000;

  function sqrt(value) {
    const ONE = ethers.BigNumber.from(1);
    const TWO = ethers.BigNumber.from(2);

    const x = BigNumber.from(value);
    let z = x.add(ONE).div(TWO);
    let y = x;
    while (z.sub(y).isNegative()) {
      y = z;
      z = x.div(z).add(z).div(TWO);
    }
    return y;
  }

  return sqrt(tokenA.mul(tokenB)).sub(MINIMUM_LIQUIDITY);
}

describe(`Testing ${TOKEN_NAME}..`, function () {
  before(async function () {
    // Set up accounts
    [ownerAccount, treasuryAccount, lrfAccount, liqudityAccount, account1, account2, account3, account4] = await ethers.getSigners();

    print(`Deploying ${TOKEN_NAME} smart contract..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    await token.deployed();

    // Set dex variables
    dexRouterAddress = await token.getRouter();
    dexRouter = await ethers.getContractAt("IDexRouter", dexRouterAddress);
    dexFactory = await ethers.getContractAt("IDexFactory", await dexRouter.factory());
    dexPairAddress = await token.getPair(); // await dexFactory.getPair(token.address, await dexRouter.WETH());
    console.log(dexPairAddress);
    dexPair = await ethers.getContractAt("IDexPair", dexPairAddress);

    // Set other global variables
    liquidityAddress = await token.getAutoLiquidityAddress();
    treasuryAddress = await token.getTreasuryAddress();
    lrfAddress = await token.getLrfAddress();
    burnAddress = await token.getBurnAddress();
  });

  it("Should mint 100m tokens", async function () {
    // expected total supply = 100m (18 decimal places)
    const expectedTotalSupply = addZeroes("100000000", DECIMALS);

    print("Treasury balance should be 100m tokens");
    expect(await token.balanceOf(treasuryAccount.address)).to.equal(expectedTotalSupply);

    print("Smart contract total supply should be 100m tokens");
    expect(await token.totalSupply()).to.equal(expectedTotalSupply);
  });

  it("Owner should be able to add 10 million tokens + 10 BNB to liquidity pool", async function () {
    // Allow DEX to transfer during presale
    await token.connect(treasuryAccount).allowPreSaleTransfer(dexRouterAddress, true);

    // Set timestamp to current block time + 100
    const latestBlock = await ethers.provider.getBlock("latest");
    const timestamp = latestBlock.timestamp + 100;

    print("Approve DEX router to transfer treasury's tokens");
    await token.connect(treasuryAccount).approve(dexRouterAddress, addZeroes("100000000", DECIMALS));

    print("Deposit 10 million tokens + 10 BNB into liquidity");
    await dexRouter.connect(treasuryAccount).addLiquidityETH(
      token.address,
      addZeroes("10000000", DECIMALS),
      0,
      0,
      treasuryAccount.address,
      timestamp,
      { value: addZeroes(10, 18) } // 10 BNB
    );
  });

  it("Liquidity pool should have 10 million / 10 BNB reserves and owner should have LP tokens", async function () {
    const tokensInLP = addZeroes("10000000", DECIMALS);
    const ethInLP = addZeroes(10, 18);
    const expectedLPtokens = calculateInitialLP(tokensInLP, ethInLP);

    // Get LP token balance for owner
    const LPtokenBalance = await dexPair.balanceOf(treasuryAccount.address);

    print("Treasury should have LP tokens after adding liquidity");
    expect(LPtokenBalance).to.equal(expectedLPtokens);

    // Check number of reserves in Pancake pair
    const reserves = await dexPair.getReserves();

    // Check which token (0/1) is eth vs token
    let tokenReserves, ethReserves;
    if ((await dexPair.token0()) === token.address) {
      tokenReserves = reserves.reserve0;
      ethReserves = reserves.reserve1;
    } else {
      tokenReserves = reserves.reserve1;
      ethReserves = reserves.reserve0;
    }

    print("Liquidity pool pair shoud have 10 BNB in reserves");
    expect(ethReserves).to.equal(addZeroes(10, 18));

    print("Liquidity pool pair should have 10 million tokens in reserves");
    expect(tokenReserves).to.equal(addZeroes("10000000", DECIMALS));
  });

  it("Should allow treasury to transfer 1000 tokens to account1", async function () {
    print("Transfer 1000 tokens from treasury to account1");
    await transferTokens(treasuryAccount, account1, addZeroes(1000, DECIMALS));

    print("account1 should have 1000 tokens (no fees collected)");
    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(1000, DECIMALS));
  });

  it("Should block account1 from transacting until trading is open", async function () {
    print("Try to transfer 100 tokens from account1 to account2");
    print("Transaction should fail with reason: 'Trading not open yet'");

    try {
      await transferTokens(account1, account2, addZeroes(100, DECIMALS));
    } catch (error) {
      expect(error.message).to.contain("Trading not open yet");
    }

    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(1000, DECIMALS));
    expect(await token.balanceOf(account2.address)).to.equal(addZeroes(0, DECIMALS));
  });

  it("Should open up trading and allow account1 to transact with account2", async function () {
    await token.connect(treasuryAccount).openTrade();

    print("Try to transfer 100 tokens from account1 to account2");
    await transferTokens(account1, account2, addZeroes(100, DECIMALS));
    expect(await token.balanceOf(account2.address)).to.equal(addZeroes(100, DECIMALS));
    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(900, DECIMALS));
  });

  it("Should apply buy fees when account3 buys shares from exchange", async function () {
    print("Account3 buys 1000 tokens from exchange");
    await dexRouter.connect(account3).swapETHForExactTokens(
      addZeroes(1000, DECIMALS), // 1000 tokens
      [await dexRouter.WETH(), token.address],
      account3.address,
      Math.floor(Date.now() / 1000) + 600, // deadline = 10 mins
      { value: BigNumber.from("10000000000000000") } // 0.001 ETH
    );

    print("Expect buy fees to be taken");
    expect(await token.balanceOf(account3.address)).to.equal(addZeroes(870, DECIMALS));
    expect(await token.balanceOf(token.address)).to.equal(addZeroes(80, DECIMALS));
    expect(await token.balanceOf(liquidityAddress)).to.equal(addZeroes(50, DECIMALS));
  });

  it("Should apply sell fees when account3 sells shares to exchange", async function () {
    await token.connect(account3).approve(dexRouter.address, BigNumber.from("1000000000000000000000000000000000000"));
    await token.connect(treasuryAccount).setAutoSwap(false);

    print("Account3 sells 100 tokens to exchange");
    await dexRouter.connect(account3).swapExactTokensForETHSupportingFeeOnTransferTokens(
      addZeroes(100, DECIMALS), // 100 tokens,
      0, // minimum ETH out
      [token.address, await dexRouter.WETH()], // pair
      account3.address, // recipient
      Math.floor(Date.now() / 1000) + 600 // deadline = 10 mins
    );

    print("Expect sell fees to be taken");
    expect(await token.balanceOf(account3.address)).to.equal(addZeroes(770, DECIMALS));
    expect(await token.balanceOf(token.address)).to.equal(addZeroes(92, DECIMALS));
    expect(await token.balanceOf(liquidityAddress)).to.equal(addZeroes(55, DECIMALS));
  });

  /*
  it("Rebase should increase each account balance by 0.016%", async function () {
    // move time forward 12 minutes
    await ethers.provider.send("evm_increaseTime", [720]);
    await ethers.provider.send("evm_mine");

    print("Manually trigger rebase");
    await token.connect(treasuryAccount).rebase();

    print("Account balances should increase by rebase rate");
    expect(await token.balanceOf(account2.address)).to.equal(addZeroes(100, DECIMALS).mul(10001600).div(10000000));
    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(900, DECIMALS).mul(10001600).div(10000000));
    expect(await token.lastEpoch()).to.equal(1);
    expect(await token.pendingRebases()).to.equal(0);
  });
  */
});
