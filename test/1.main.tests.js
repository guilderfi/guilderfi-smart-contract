const { expect } = require("chai");
const { ethers } = require("hardhat");

const {
  transferTokens,
  buyTokens,
  sellTokens,
  addLiquidity,
  getLiquidityReserves,
  calculateEthToReceive,
  calculateLPtokens,
  addZeroes,
  print,
} = require("./helpers");

const TOKEN_NAME = "GuilderFi";
const DECIMALS = 18;
const DEAD = ethers.utils.getAddress("0x000000000000000000000000000000000000dEaD");

let token;
let router;
let pair;

let treasury;
let lrf;
let safeExit;
let account1;
let account2;
let account3;

describe(`Testing ${TOKEN_NAME}..`, function () {
  before(async function () {
    // Set up accounts
    [, treasury, account1, account2, account3] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    global.token = token;
    await token.deployed();

    print(`Token address: ${token.address}`);

    // Set dex variables
    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    pair = await ethers.getContractAt("IDexPair", await token.getPair());

    // contracts
    lrf = await ethers.getContractAt("LiquidityReliefFund", await token.lrf());
    safeExit = await ethers.getContractAt("SafeExitFund", await token.safeExitFund());
  });

  it("Should mint 100m tokens", async function () {
    // Set all frequencies to 1 day
    await token.connect(treasury).setSwapFrequency(86400);
    await token.connect(treasury).setLrfFrequency(86400);
    await token.connect(treasury).setAutoLiquidityFrequency(86400);

    expect(await token.totalSupply()).to.equal(addZeroes("100000000", DECIMALS));
    expect(await token.balanceOf(treasury.address)).to.equal(addZeroes("100000000", DECIMALS));
  });

  it("Treasury should be able to add initial liquidity to liquidity pool", async function () {
    // Approve DEX to transfer
    await token.connect(treasury).allowPreSaleTransfer(router.address, true);
    await token.connect(treasury).approve(router.address, addZeroes("999999999999", DECIMALS));

    // Add 10 million tokens + 10 BNB into liquidity
    const tokenAmount = addZeroes("10000000", DECIMALS);
    const ethAmount = addZeroes(10, 18);

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
    expect(ethReserves).to.equal(addZeroes(10, 18));
    expect(tokenReserves).to.equal(addZeroes("10000000", DECIMALS));
  });

  it("Should allow treasury to transfer tokens during pre-sale", async function () {
    await transferTokens({ token, from: treasury, to: account1, amount: addZeroes(1000, DECIMALS) });

    // no fees should be collected
    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(1000, DECIMALS));
  });

  it("Should block other accounts from transacting until trading is open", async function () {
    try {
      await transferTokens({ token, from: account1, to: account2, amount: addZeroes(100, DECIMALS) });
    } catch (error) {
      expect(error.message).to.contain("Trading not open yet");
    }

    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(1000, DECIMALS));
    expect(await token.balanceOf(account2.address)).to.equal(addZeroes(0, DECIMALS));

    // account1 buys 1000 tokens
    await token.connect(account1).approve(router.address, addZeroes("999999999999", DECIMALS));
    try {
      await buyTokens({ router, token, account: account1, tokenAmount: addZeroes(1000, DECIMALS) });
    } catch (error) {
      expect(error.message).to.contain("TRANSFER_FAILED");
    }

    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(1000, DECIMALS));
    expect(await token.balanceOf(account2.address)).to.equal(addZeroes(0, DECIMALS));
  });

  it("Should open up trading and allow accounts to transact", async function () {
    await token.connect(treasury).openTrade();
    await token.connect(treasury).launchToken();
    await transferTokens({ token, from: account1, to: account2, amount: addZeroes(100, DECIMALS) });
    expect(await token.balanceOf(account2.address)).to.equal(addZeroes(100, DECIMALS));
    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(900, DECIMALS));
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

    await buyTokens({ router, token, account: account3, tokenAmount: addZeroes(1000, DECIMALS) });

    // check that fees have been taken
    expect(await token.balanceOf(account3.address)).to.equal(addZeroes(850, DECIMALS));
    expect(await token.balanceOf(token.address)).to.equal(addZeroes(70, DECIMALS));
    expect(await token.balanceOf(await token.autoLiquidityEngine())).to.equal(addZeroes(30, DECIMALS));
    expect(await token.balanceOf(DEAD)).to.equal(addZeroes(50, DECIMALS));
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

    await sellTokens({ router, token, account: account1, tokenAmount: addZeroes(900, DECIMALS) });

    // check that fees have been taken
    expect(await token.balanceOf(account1.address)).to.equal(0);
    expect(await token.balanceOf(token.address)).to.equal(addZeroes(70 + 90, DECIMALS));
    expect(await token.balanceOf(await token.autoLiquidityEngine())).to.equal(addZeroes(30 + 45, DECIMALS));
    expect(await token.balanceOf(DEAD)).to.equal(addZeroes(50 + 9, DECIMALS));
  });

  it("Should swap tokens collected for ETH", async function () {
    // set frequency to zero to force swap on next transaction
    await token.connect(treasury).setSwapFrequency(0);

    // record balances
    const treasuryEthBalanceBefore = await ethers.provider.getBalance(treasury.address);
    const lrfEthBalanceBefore = await ethers.provider.getBalance(lrf.address);
    const safeExitEthBalanceBefore = await ethers.provider.getBalance(safeExit.address);

    // calculate how much eth received when swaping 160 tokens
    expect(await token.balanceOf(token.address)).to.equal(addZeroes(160, DECIMALS));
    const ethToReceive = await calculateEthToReceive({ token, pair, tokenAmount: addZeroes(160, DECIMALS) });

    // sell tokens
    await token.connect(account2).approve(router.address, addZeroes("999999999999", DECIMALS));
    await sellTokens({ router, token, account: account2, tokenAmount: addZeroes(100, DECIMALS) });

    // record balances after
    const treasuryEthBalanceAfter = await ethers.provider.getBalance(treasury.address);
    const lrfEthBalanceAfter = await ethers.provider.getBalance(lrf.address);
    const safeExitEthBalanceAfter = await ethers.provider.getBalance(safeExit.address);

    // check that balances have been updated
    expect(await token.balanceOf(account2.address)).to.equal(0);
    expect(await token.balanceOf(token.address)).to.equal(addZeroes(10, DECIMALS));

    const treasuryEthDifference = treasuryEthBalanceAfter.sub(treasuryEthBalanceBefore);
    const lrfEthDifference = lrfEthBalanceAfter.sub(lrfEthBalanceBefore);
    const safeExitEthDifference = safeExitEthBalanceAfter.sub(safeExitEthBalanceBefore);

    // check balances have increased by appropriate share (within 0.000000000000000001% accuracy to account for rounding)
    expect(treasuryEthDifference).to.be.closeTo(ethToReceive.mul(55).div(160), 1);
    expect(lrfEthDifference).to.be.closeTo(ethToReceive.mul(47).div(160), 1);
    expect(safeExitEthDifference).to.be.closeTo(ethToReceive.mul(58).div(160), 1);
  });

  it("Auto liquidity engine should should add liquidity to exchange", async function () {
    // set frequency to zero to force auto liquidity on next transaction
    await token.connect(treasury).setSwapFrequency(84600);
    await token.connect(treasury).setAutoLiquidityFrequency(0);

    const reservesBefore = await getLiquidityReserves({ token, pair });

    // do a transaction
    await token.connect(account3).transfer(account2.address, addZeroes(100, DECIMALS));

    // check dex reserves after transaction
    const reservesAfter = await getLiquidityReserves({ token, pair });
    const ethReservesDifference = reservesAfter.ethReserves.sub(reservesBefore.ethReserves);
    const tokenReservesDifference = reservesAfter.tokenReserves.sub(reservesBefore.tokenReserves);

    expect(ethReservesDifference).to.equal(0);
    expect(tokenReservesDifference).to.be.closeTo(addZeroes(80, DECIMALS), addZeroes(1, DECIMALS));
  });

  it("Should allow transactions when all features are enabled", async function () {
    // turn on all features
    // buy
    // sell
  });
});
