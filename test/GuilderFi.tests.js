const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const clc = require("cli-color");

const TOKEN_NAME = "GuilderFi";
const DECIMALS = 18;
const DEAD = ethers.utils.getAddress("0x000000000000000000000000000000000000dEaD");

let token;
let dexRouter;
let dexRouterAddress;
let dexPair;
let dexPairAddress;

let owner;
let treasuryAccount;
let lrfContract;
let safeExitFundContract;
let preSale;
let strategicReserves;
let marketing;
let account1;
let account2;
let account3;

function addZeroes(num, zeroes) {
  return BigNumber.from(num).mul(BigNumber.from(10).pow(zeroes));
}

function print(msg) {
  console.log(clc.xterm(8)("      " + msg));
}

// eslint-disable-next-line no-unused-vars
async function printStatus() {
  const treasuryBalance = await ethers.provider.getBalance(treasuryAccount.address);
  const lrfBalance = await ethers.provider.getBalance(lrfContract.address);
  const lrfTokenBalance = await token.balanceOf(lrfContract.address);
  const feesCollected = await token.balanceOf(token.address);
  const { ethReserves, tokenReserves } = await getLiquidityReserves();
  const liquidityTokens = await token.balanceOf(await token.autoLiquidityEngine());
  const safeExitFundBalance = await ethers.provider.getBalance(safeExitFundContract.address);
  const backedLiquidity = BigNumber.from("1000000000000000000")
    .mul(treasuryBalance.add(lrfBalance))
    .div(ethReserves.mul(BigNumber.from("10000000000000000")));

  console.log();
  console.log(`Treasury - eth:   ${ethers.utils.formatEther(treasuryBalance, { comify: true })}`);
  console.log(`LRF - eth:        ${ethers.utils.formatEther(lrfBalance, { comify: true })}`);
  console.log(`LRF - tokens:     ${ethers.utils.formatEther(lrfTokenBalance, { comify: true })}`);
  console.log(`Total assets:     ${ethers.utils.formatEther(lrfBalance.add(treasuryBalance), { comify: true })}`);
  console.log();
  console.log(`LP - eth:         ${ethers.utils.formatEther(ethReserves, { comify: true })}`);
  console.log(`LP - tokens:      ${ethers.utils.formatEther(tokenReserves, { comify: true })}`);
  console.log(`Backed liquidity: ${backedLiquidity}%`);
  console.log();
  console.log(`Token fees coll:  ${ethers.utils.formatEther(feesCollected, { comify: true })}`);
  console.log(`Liquidity tokens: ${ethers.utils.formatEther(liquidityTokens, { comify: true })}`);
  console.log();
  console.log(`Safe exit fund:   ${ethers.utils.formatEther(safeExitFundBalance, { comify: true })}`);
}

async function transferTokens(from, to, amount) {
  const transaction = await token.connect(from).transfer(to.address, amount);
  await transaction.wait();
}

async function transferEth(from, to, amount) {
  const tx = await from.sendTransaction({
    to: to.address,
    value: amount,
  });
  await tx.wait();
}

async function addLiquidity(from, token, tokenAmount, ethAmount) {
  const timestamp = (await ethers.provider.getBlock("latest")).timestamp + 100;
  await dexRouter.connect(from).addLiquidityETH(token.address, tokenAmount, 0, 0, from.address, timestamp, {
    value: ethAmount,
  });
}

async function buyTokens(account, tokenAmount) {
  await dexRouter
    .connect(account)
    .swapETHForExactTokens(
      tokenAmount,
      [await dexRouter.WETH(), token.address],
      account.address,
      (await ethers.provider.getBlock("latest")).timestamp + 100,
      { value: BigNumber.from("10000000000000000") }
    );
}

async function sellTokens(account, tokenAmount) {
  await dexRouter.connect(account).swapExactTokensForETHSupportingFeeOnTransferTokens(
    tokenAmount,
    0, // minimum ETH out
    [token.address, await dexRouter.WETH()], // pair
    account.address, // recipient
    (await ethers.provider.getBlock("latest")).timestamp + 100
  );

}

async function getLiquidityReserves() {
  let returnVal;
  const reserves = await dexPair.getReserves();

  // Check which token (0/1) is eth vs token
  if ((await dexPair.token0()) === token.address) {
    returnVal = {
      tokenReserves: reserves.reserve0,
      ethReserves: reserves.reserve1,
    };
  } else {
    returnVal = {
      tokenReserves: reserves.reserve1,
      ethReserves: reserves.reserve0,
    };
  }

  returnVal.tokenPrice = returnVal.ethReserves.div(returnVal.tokenReserves);
  return returnVal;
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
    [owner, treasuryAccount, preSale, strategicReserves, marketing, account1, account2, account3] = await ethers.getSigners();

    print(`Deploying ${TOKEN_NAME} smart contract..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    await token.deployed();

    print(`Smart contract address: ${token.address}`);

    // Set dex variables
    dexRouterAddress = await token.getRouter();
    dexRouter = await ethers.getContractAt("IDexRouter", dexRouterAddress);
    dexPairAddress = await token.getPair();
    dexPair = await ethers.getContractAt("IDexPair", dexPairAddress);

    // contracts
    lrfContract = await ethers.getContractAt("LiquidityReliefFund", await token.lrf());
    safeExitFundContract = await ethers.getContractAt("SafeExitFund", await token.safeExitFund());
  });

  it("Should mint 100m tokens", async function () {
    // send 1 eth to LRF
    transferEth(owner, lrfContract, ethers.utils.parseEther("1.0"));

    // initial distribution
    await transferTokens(treasuryAccount, preSale, addZeroes(27000000, 18));
    await transferTokens(treasuryAccount, strategicReserves, addZeroes(10000000, 18));
    await transferTokens(treasuryAccount, marketing, addZeroes(5000000, 18));
    await transferTokens(treasuryAccount, lrfContract, addZeroes(32136765, 18));

    // Set all frequencies to 1 day
    await token.connect(treasuryAccount).setSwapFrequency(86400);
    await token.connect(treasuryAccount).setLrfFrequency(86400);
    await token.connect(treasuryAccount).setAutoLiquidityFrequency(86400);

    expect(await token.totalSupply()).to.equal(addZeroes("100000000", DECIMALS));
    expect(await token.balanceOf(treasuryAccount.address)).to.equal(addZeroes("25863235", DECIMALS));
  });

  it("Treasury should be able to add initial liquidity to liquidity pool", async function () {
    // Approve DEX to transfer
    await token.connect(treasuryAccount).allowPreSaleTransfer(dexRouterAddress, true);
    await token.connect(treasuryAccount).approve(dexRouterAddress, addZeroes("999999999999", DECIMALS));

    // Deposit 10 million tokens + 10 BNB into liquidity
    await addLiquidity(treasuryAccount, token, addZeroes("10000000", DECIMALS), addZeroes(10, 18));

    const tokensInLP = addZeroes("10000000", DECIMALS);
    const ethInLP = addZeroes(10, 18);
    const expectedLPtokens = calculateInitialLP(tokensInLP, ethInLP);

    // Treasury should have LP tokens after adding liquidity
    expect(await dexPair.balanceOf(treasuryAccount.address)).to.equal(expectedLPtokens);

    // Check eth/token reserves in DEX pair
    const { ethReserves, tokenReserves } = await getLiquidityReserves();
    expect(ethReserves).to.equal(addZeroes(10, 18));
    expect(tokenReserves).to.equal(addZeroes("10000000", DECIMALS));

    // await printStatus();
  });

  it("Should allow treasury to transfer tokens during pre-sale", async function () {
    await transferTokens(treasuryAccount, account1, addZeroes(1000, DECIMALS));

    // no fees should be collected
    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(1000, DECIMALS));
  });

  it("Should block other accounts from transacting until trading is open", async function () {
    try {
      await transferTokens(account1, account2, addZeroes(100, DECIMALS));
    } catch (error) {
      expect(error.message).to.contain("Trading not open yet");
    }

    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(1000, DECIMALS));
    expect(await token.balanceOf(account2.address)).to.equal(addZeroes(0, DECIMALS));

    // account1 buys 1000 tokens
    await token.connect(account1).approve(dexRouterAddress, addZeroes("999999999999", DECIMALS));
    try {
      await buyTokens(account1, addZeroes(1000, DECIMALS));
    } catch (error) {
      expect(error.message).to.contain("TRANSFER_FAILED");
    }

    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(1000, DECIMALS));
    expect(await token.balanceOf(account2.address)).to.equal(addZeroes(0, DECIMALS));

    // await printStatus();
  });

  it("Should open up trading and allow accounts to transact", async function () {
    await token.connect(treasuryAccount).openTrade();
    await token.connect(treasuryAccount).launchToken();
    await transferTokens(account1, account2, addZeroes(100, DECIMALS));
    expect(await token.balanceOf(account2.address)).to.equal(addZeroes(100, DECIMALS));
    expect(await token.balanceOf(account1.address)).to.equal(addZeroes(900, DECIMALS));

    // await printStatus();
  });

  it("Should apply buy fees when buying shares from exchange", async function () {
    // set fees to 20.1% - expect error
    try {
      await token.connect(treasuryAccount).setFees(
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
    await token.connect(treasuryAccount).setFees(
      false, // _isSellFee,
      50, // 5% _treasuryFee,
      50, // 5% _lrfFee,
      50, // 5% _liquidityFee,
      49, // 4.9% _safeExitFee,
      1 // 0.1%  _burnFee
    );

    // set fees
    await token.connect(treasuryAccount).setFees(
      false, // _isSellFee,
      10, // 1% _treasuryFee,
      20, // 2% _lrfFee,
      30, // 3% _liquidityFee,
      40, // 4% _safeExitFee,
      50 // 5%  _burnFee
    );

    await buyTokens(account3, addZeroes(1000, DECIMALS));

    // check that fees have been taken
    expect(await token.balanceOf(account3.address)).to.equal(addZeroes(850, DECIMALS));
    expect(await token.balanceOf(token.address)).to.equal(addZeroes(70, DECIMALS));
    expect(await token.balanceOf(await token.autoLiquidityEngine())).to.equal(addZeroes(30, DECIMALS));
    expect(await token.balanceOf(DEAD)).to.equal(addZeroes(50, DECIMALS));

    // await printStatus();
  });

  it("Should apply sell fees when selling shares to exchange", async function () {

    // set fees to 25.1% - expect error
    try {
      await token.connect(treasuryAccount).setFees(
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
    await token.connect(treasuryAccount).setFees(
      true, // _isSellFee,
      50, // 5% _treasuryFee,
      50, // 5% _lrfFee,
      50, // 5% _liquidityFee,
      50, // 5% _safeExitFee,
      50 // 5%  _burnFee
    );

    // set fees
    await token.connect(treasuryAccount).setFees(
      true, // _isSellFee,
      50, // 5% _treasuryFee,
      30, // 3% _lrfFee,
      50, // 5% _liquidityFee,
      20, // 2% _safeExitFee,
      10 // 1%  _burnFee
    );

    await sellTokens(account1, addZeroes(900, DECIMALS));

    // check that fees have been taken
    expect(await token.balanceOf(account1.address)).to.equal(0);
    expect(await token.balanceOf(token.address)).to.equal(addZeroes(70 + 90, DECIMALS));
    expect(await token.balanceOf(await token.autoLiquidityEngine())).to.equal(addZeroes(30 + 45, DECIMALS));
    expect(await token.balanceOf(DEAD)).to.equal(addZeroes(50 + 9, DECIMALS));

    // await printStatus();
  });

  it("Should swap tokens collected for ETH", async function () {
    await token.connect(treasuryAccount).setSwapFrequency(0);

    await token.connect(account2).approve(dexRouterAddress, addZeroes("999999999999", DECIMALS));
    await sellTokens(account2, addZeroes(100, DECIMALS));

    expect(await token.balanceOf(account2.address)).to.equal(0);
    expect(await token.balanceOf(token.address)).to.equal(addZeroes(10, DECIMALS));
  });

  /*
  it("Rebase should increase each account balance by 0.016% after 12 minutes", async function () {
    // move time forward 12 minutes
    await ethers.provider.send("evm_increaseTime", [720]);
    await ethers.provider.send("evm_mine");

    expect(await token.pendingRebases()).to.equal(1);

    // trigger rebase
    await token.connect(treasuryAccount).rebase();

    // check that rebase has been applied
    expect(await token.balanceOf(account2.address)).to.equal(BigNumber.from("100016030912247000000"));
    expect(await token.balanceOf(account1.address)).to.equal(BigNumber.from("900144278210223000000"));
    expect(await token.lastEpoch()).to.equal(1);
    expect(await token.pendingRebases()).to.equal(0);
  });

  it("Rebase should perform rebases in max batch sizes", async function () {
    // move time forward by 100 rebases)
    await ethers.provider.send("evm_increaseTime", [720 * 100]);
    await ethers.provider.send("evm_mine");

    expect(await token.pendingRebases()).to.equal(100);

    // trigger rebase
    await token.connect(treasuryAccount).rebase();

    expect(await token.balanceOf(account2.address)).to.be.closeTo(BigNumber.from("100659379119725000000"), 1000000);
    expect(await token.balanceOf(account1.address)).to.be.closeTo(BigNumber.from("905934412077523000000"), 1000000);
    expect(await token.lastEpoch()).to.equal(41);
    expect(await token.pendingRebases()).to.equal(60);

    await token.connect(treasuryAccount).rebase();
    expect(await token.balanceOf(account2.address)).to.be.closeTo(BigNumber.from("101306865632955000000"), 2500000);
    expect(await token.balanceOf(account1.address)).to.be.closeTo(BigNumber.from("911761790696595000000"), 2500000);
    expect(await token.lastEpoch()).to.equal(81);
    expect(await token.pendingRebases()).to.equal(20);

    await token.connect(treasuryAccount).rebase();
    expect(await token.balanceOf(account2.address)).to.be.closeTo(BigNumber.from("101632169066129000000"), 5000000);
    expect(await token.balanceOf(account1.address)).to.be.closeTo(BigNumber.from("914689521595163000000"), 5000000);
    expect(await token.lastEpoch()).to.equal(101);
    expect(await token.pendingRebases()).to.equal(0);

    try {
      await token.connect(treasuryAccount).rebase();
    } catch (error) {
      expect(error.message).to.contain("No pending rebases");
    }

    expect(await token.balanceOf(account2.address)).to.be.closeTo(BigNumber.from("101632169066129000000"), 5000000);
    expect(await token.balanceOf(account1.address)).to.be.closeTo(BigNumber.from("914689521595163000000"), 5000000);
    expect(await token.lastEpoch()).to.equal(101);
    expect(await token.pendingRebases()).to.equal(0);
  });
  */
});
