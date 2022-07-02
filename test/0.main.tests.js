const { expect } = require("chai");
const { ethers } = require("hardhat");

const { deploy } = require("../helpers/deploy");
const { MAX_INT, TOKEN_NAME, ether, print, createWallet } = require("../helpers/utils");
const {
  transferTokens,
  buyTokensFromDex,
  sellTokens,
  addLiquidity,
  getLiquidityReserves,
  calculateEthToReceive,
  calculateLPtokens,
  transferEth,
} = require("../helpers");

const DEAD = ethers.utils.getAddress("0x000000000000000000000000000000000000dEaD");

let token;
let deployer;
let treasury;
let router;
let pair;
let lrf;
let safeExit;

const account1 = createWallet(ethers);
const account2 = createWallet(ethers);
const account3 = createWallet(ethers);

/* 
  DONT USE THIS FUNCTION
  USE getLiquidityReserves().tokenPrice from helpers/index.js instead
*/
/*
const ETH_PRICE_PRECISION = 8;
async function calculateTokenETHPrice(pair) {
  const { reserve0, reserve1 } = await pair.getReserves();
  return reserve0.mul(Math.pow(10, ETH_PRICE_PRECISION)).div(reserve1);
}
*/

describe(`Testing ${TOKEN_NAME}..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);
    token = await deploy({ ethers, deployer, treasury });

    // contracts
    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    pair = await ethers.getContractAt("IDexPair", await token.getPair());
    lrf = await ethers.getContractAt("LiquidityReliefFund", await token.getLrfAddress());
    safeExit = await ethers.getContractAt("SafeExitFund", await token.getSafeExitFundAddress());

    // transfer some eth to test accounts
    await transferEth({ from: deployer, to: account1, amount: ether(10) });
    await transferEth({ from: deployer, to: account2, amount: ether(10) });
    await transferEth({ from: deployer, to: account3, amount: ether(10) });
  });

  it("Should mint 1m tokens", async function () {
    // Set all frequencies to 1 day
    await token.connect(treasury).setSwapFrequency(86400);
    await token.connect(treasury).setLrfFrequency(86400);
    await token.connect(treasury).setAutoLiquidityFrequency(86400);

    expect(await token.totalSupply()).to.equal(ether(1000000));
    expect(await token.balanceOf(treasury.address)).to.equal(ether(1000000));
  });

  it("Treasury should be able to add initial liquidity to liquidity pool", async function () {
    // Approve DEX to transfer
    await token.connect(treasury).approve(router.address, MAX_INT);

    // Add 100k tokens + 10 BNB into liquidity
    const tokenAmount = ether(100000);
    const ethAmount = ether(10);

    await addLiquidity({
      router,
      from: treasury,
      token,
      tokenAmount,
      ethAmount,
    });

    const expectedLPtokens = calculateLPtokens({ tokenAmount, ethAmount });

    // Treasury should have LP tokens after adding liquidity
    expect(await pair.balanceOf(treasury.address)).to.equal(expectedLPtokens);

    // Check eth/token reserves in DEX pair
    const { ethReserves, tokenReserves } = await getLiquidityReserves({ token, pair });
    expect(ethReserves).to.equal(ether(10, 18));
    expect(tokenReserves).to.equal(ether(100000));
  });

  it("Should allow treasury to transfer tokens during pre-sale", async function () {
    await transferTokens({ token, from: treasury, to: account1, amount: ether(1000) });

    // no fees should be collected
    expect(await token.balanceOf(account1.address)).to.equal(ether(1000));
  });

  it("Should open up trading and allow accounts to transact", async function () {
    // await token.connect(treasury).openTrade();
    await token.connect(treasury).launchToken();
    await transferTokens({ token, from: account1, to: account2, amount: ether(100) });
    expect(await token.balanceOf(account2.address)).to.equal(ether(100));
    expect(await token.balanceOf(account1.address)).to.equal(ether(900));
  });

  it("Should apply buy fees when buying shares from exchange", async function () {
    // set fees to 20.1% - expect error
    try {
      await token.connect(treasury).setFees(
        false, // _isSellFee,
        50, // 5% _treasuryFee,
        50, // 5% _lrfFee,
        50, // 5% _liquidityFee,
        50, // 5% _safeExitFee,
        1 // 0.1%  _burnFee
      );
    } catch (error) {
      expect(error.message).to.contain("Buy fees are too high");
    }

    // set fees to 20% - expect no error
    await token.connect(treasury).setFees(
      false, // _isSellFee,
      50, // 5% _treasuryFee,
      50, // 5% _lrfFee,
      50, // 5% _liquidityFee,
      49, // 4.9% _safeExitFee,
      1 // 0.1%  _burnFee
    );

    // set fees
    await token.connect(treasury).setFees(
      false, // _isSellFee,
      10, // 1% _treasuryFee,
      20, // 2% _lrfFee,
      30, // 3% _liquidityFee,
      40, // 4% _safeExitFee,
      50 // 5%  _burnFee
    );

    await buyTokensFromDex({ router, pair, token, account: account3, tokenAmount: ether(1000) });

    // check that fees have been taken
    expect(await token.balanceOf(account3.address)).to.equal(ether(850));
    expect(await token.balanceOf(await token.getSwapEngineAddress())).to.equal(ether(70));
    expect(await token.balanceOf(await token.getAutoLiquidityAddress())).to.equal(ether(30));
    expect(await token.balanceOf(DEAD)).to.equal(ether(50));
  });

  it("Should apply sell fees when selling shares to exchange", async function () {
    // set fees to 25.1% - expect error
    try {
      await token.connect(treasury).setFees(
        true, // _isSellFee,
        50, // 5% _treasuryFee,
        50, // 5% _lrfFee,
        50, // 5% _liquidityFee,
        50, // 5% _safeExitFee,
        51 // 5.1%  _burnFee
      );
    } catch (error) {
      expect(error.message).to.contain("Sell fees are too high");
    }

    // set fees to 25% - expect no error
    await token.connect(treasury).setFees(
      true, // _isSellFee,
      50, // 5% _treasuryFee,
      50, // 5% _lrfFee,
      50, // 5% _liquidityFee,
      50, // 5% _safeExitFee,
      50 // 5%  _burnFee
    );

    // set fees
    await token.connect(treasury).setFees(
      true, // _isSellFee,
      50, // 5% _treasuryFee,
      30, // 3% _lrfFee,
      50, // 5% _liquidityFee,
      20, // 2% _safeExitFee,
      10 // 1%  _burnFee
    );

    await token.connect(account1).approve(router.address, MAX_INT);
    await sellTokens({ router, token, account: account1, tokenAmount: ether(900) });

    // check that fees have been taken
    expect(await token.balanceOf(account1.address)).to.equal(0);
    expect(await token.balanceOf(await token.getSwapEngineAddress())).to.equal(ether(70 + 90));
    expect(await token.balanceOf(await token.getAutoLiquidityAddress())).to.equal(ether(30 + 45));
    expect(await token.balanceOf(DEAD)).to.equal(ether(50 + 9));
  });

  /* SHOULD THIS TEST BE REMOVED? SWAP ENGINE IS TESTED AGAIN AT THE END OF THIS TEST SUITE */
  it("Should swap tokens collected for ETH", async function () {
    // set frequency to zero to force swap on next transaction
    await token.connect(treasury).setSwapFrequency(0);

    // record balances
    const treasuryEthBalanceBefore = await ethers.provider.getBalance(treasury.address);
    const lrfEthBalanceBefore = await ethers.provider.getBalance(lrf.address);
    const safeExitEthBalanceBefore = await ethers.provider.getBalance(safeExit.address);

    // calculate how much eth received when swapping 160 tokens
    expect(await token.balanceOf(await token.getSwapEngineAddress())).to.equal(ether(160));
    const ethToReceive = await calculateEthToReceive({ token, pair, tokenAmount: ether(160) });

    // sell tokens
    await token.connect(account2).approve(router.address, ether(999999999999));
    await sellTokens({ router, token, account: account2, tokenAmount: ether(100) });

    // record balances after
    const treasuryEthBalanceAfter = await ethers.provider.getBalance(treasury.address);
    const lrfEthBalanceAfter = await ethers.provider.getBalance(lrf.address);
    const safeExitEthBalanceAfter = await ethers.provider.getBalance(safeExit.address);

    // check that balances have been updated
    expect(await token.balanceOf(account2.address)).to.equal(0);
    expect(await token.balanceOf(await token.getSwapEngineAddress())).to.equal(ether(10));

    const treasuryEthDifference = treasuryEthBalanceAfter.sub(treasuryEthBalanceBefore);
    const lrfEthDifference = lrfEthBalanceAfter.sub(lrfEthBalanceBefore);
    const safeExitEthDifference = safeExitEthBalanceAfter.sub(safeExitEthBalanceBefore);

    // check balances have increased by appropriate share (within 0.000001% accuracy to account for rounding)
    expect(treasuryEthDifference).to.be.closeTo(ethToReceive.mul(55).div(160), ether(0.000001));
    expect(lrfEthDifference).to.be.closeTo(ethToReceive.mul(47).div(160), ether(0.000001));
    expect(safeExitEthDifference).to.be.closeTo(ethToReceive.mul(58).div(160), ether(0.000001));
  });

  it("Auto liquidity engine should should add liquidity to exchange", async function () {
    // set frequency to zero to force auto liquidity on next transaction
    await token.connect(treasury).setSwapFrequency(84600);
    await token.connect(treasury).setAutoLiquidity(false);
    await token.connect(treasury).setAutoLiquidityFrequency(0);

    expect(await token.balanceOf(await token.getAutoLiquidityAddress())).to.equal(ether(80));

    const reservesBefore = await getLiquidityReserves({ token, pair });

    // do a transaction
    await token.connect(account3).transfer(account2.address, ether(100));

    // Run execute manually
    const autoLiquidityEngine = await ethers.getContractAt("IAutoLiquidityEngine", await token.getAutoLiquidityAddress());
    await autoLiquidityEngine.connect(treasury).execute();

    // check dex reserves after transaction
    const reservesAfter = await getLiquidityReserves({ token, pair });
    const ethReservesDifference = reservesAfter.ethReserves.sub(reservesBefore.ethReserves);
    const tokenReservesDifference = reservesAfter.tokenReserves.sub(reservesBefore.tokenReserves);

    expect(ethReservesDifference).to.equal(0);
    expect(tokenReservesDifference).to.be.closeTo(ether(80), ether(1));
    // expect(await token.balanceOf(await token.getAutoLiquidityAddress())).to.be.closeTo(0, ether(1));
  });

  it("Swap engine should swap token to ETH and distribute proceeds", async function () {
    await token.connect(treasury).setFees(
      true, // _isSellFee,
      50, // 5% _treasuryFee,
      30, // 3% _lrfFee,
      50, // 5% _liquidityFee,
      20, // 2% _safeExitFee,
      10 // 1%  _burnFee
    );

    const swapEngine = await ethers.getContractAt("ISwapEngine", await token.getSwapEngineAddress());
    const autoLiquidityEngine = await ethers.getContractAt("IAutoLiquidityEngine", await token.getAutoLiquidityAddress());
    const safeExitFundAddress = await token.getSafeExitFundAddress();
    const treasuryAddress = await token.getTreasuryAddress();

    // const SwapETHBalanceBefore = await ethers.provider.getBalance(swapEngine.address);
    // const ALEETHBalanceBefore = await ethers.provider.getBalance(autoLiquidityEngine.address);
    const LRFETHBalanceBefore = await ethers.provider.getBalance(lrf.address);
    const safeExitFundETHBalanceBefore = await ethers.provider.getBalance(safeExitFundAddress);
    const treasuryBalanceBefore = await ethers.provider.getBalance(treasuryAddress);
    // const deadBalanceBefore = await ethers.provider.getBalance(DEAD);

    // do a transaction
    await buyTokensFromDex({ router, pair, token, account: account1, tokenAmount: ether(1000) });

    // Run execute manually
    const swapExecuteTx = await swapEngine.connect(treasury).execute();
    const swapExecuteReceipt = await swapExecuteTx.wait();
    const swapExecuteGasUsed = BigInt(swapExecuteReceipt.cumulativeGasUsed) * BigInt(swapExecuteReceipt.effectiveGasPrice);

    const swapTokenBalanceAfter = await token.balanceOf(swapEngine.address);

    const swapETHBalanceAfter = await ethers.provider.getBalance(swapEngine.address);
    const ALEETHBalanceAfter = await ethers.provider.getBalance(autoLiquidityEngine.address);
    const LRFETHBalanceAfter = await ethers.provider.getBalance(lrf.address);
    const safeExitFundETHBalanceAfter = await ethers.provider.getBalance(safeExitFundAddress);
    const treasuryBalanceAfter = await ethers.provider.getBalance(treasuryAddress);
    // const deadBalanceAfter = await ethers.provider.getBalance(DEAD);

    expect(swapTokenBalanceAfter).to.eq(0);
    expect(swapETHBalanceAfter).to.eq(0);
    expect(ALEETHBalanceAfter).to.eq(0);

    expect(treasuryBalanceAfter.sub(treasuryBalanceBefore).add(swapExecuteGasUsed)).to.gt(0);
    expect(safeExitFundETHBalanceAfter.sub(safeExitFundETHBalanceBefore)).to.gt(0);
    expect(LRFETHBalanceAfter.sub(LRFETHBalanceBefore)).to.gt(0);

    // expect(deadBalanceAfter.sub(deadBalanceBefore)).to.gt(0);
  });
});
