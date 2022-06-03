const { expect } = require("chai");
const { ethers } = require("hardhat");

const { deploy } = require("../helpers/deploy");
const { ether, print, createWallet } = require("../helpers/utils");
const { transferTokens, calculateLPtokens, getLiquidityReserves, gasUsed, transferEth } = require("../helpers");

let token;
let deployer;
let treasury;
let pair;
let preSale;

const account1 = createWallet(ethers);
const account2 = createWallet(ethers);
const account3 = createWallet(ethers);
const account4 = createWallet(ethers);
const account5 = createWallet(ethers);
const account6 = createWallet(ethers);
const account7 = createWallet(ethers);

const { tier1, tier2, tier3, publicTier } = require("../helpers/data");

let tokensPurchased = ether(0);
let ethSpent = ether(0);

const testPurchase = async ({ account, ethAmount, expectedTokens }) => {
  // get current balances
  const existingLockerAddress = await preSale.locker(account.address);
  const lockerBalanceBefore = await token.balanceOf(existingLockerAddress);
  const tokenBalanceBefore = await token.balanceOf(account.address);
  const tokenAmountBefore = tokenBalanceBefore.add(lockerBalanceBefore);

  // buy tokens
  await preSale.connect(account).buyTokens({ value: ethAmount });

  // check tokens received
  const lockerAddress = await preSale.locker(account.address);
  const tokenAmountAfter = (await token.balanceOf(account.address)).add(await token.balanceOf(lockerAddress));

  const tokenAmount = tokenAmountAfter.sub(tokenAmountBefore);
  expect(tokenAmount).to.equal(expectedTokens);

  tokensPurchased = tokensPurchased.add(tokenAmount);
  ethSpent = ethSpent.add(ethAmount);
};

describe(`Testing pre-sale..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);
    token = await deploy({ ethers, deployer, treasury });

    // contracts
    pair = await ethers.getContractAt("IDexPair", await token.getPair());
    preSale = await ethers.getContractAt("PreSale", await token.getPreSaleAddress());

    // send 27m tokens to presale contract
    await transferTokens({ token, from: treasury, to: preSale, amount: ether(50000000) });

    // transfer some eth to test accounts
    await transferEth({ from: deployer, to: account1, amount: ether(150) });
    await transferEth({ from: deployer, to: account2, amount: ether(150) });
    await transferEth({ from: deployer, to: account3, amount: ether(150) });
    await transferEth({ from: deployer, to: account4, amount: ether(150) });
    await transferEth({ from: deployer, to: account5, amount: ether(150) });
    await transferEth({ from: deployer, to: account6, amount: ether(150) });
    await transferEth({ from: deployer, to: account7, amount: ether(150) });
  });

  it("Should prevent purchasing until public sale is enabled", async function () {
    expect(await preSale.isPublicSaleOpen()).to.equal(false);
    expect(await preSale.isWhitelistSaleOpen(1)).to.equal(false);
    expect(await preSale.isWhitelistSaleOpen(2)).to.equal(false);
    expect(await preSale.isWhitelistSaleOpen(3)).to.equal(false);
    expect(await preSale.isWhitelistSaleOpen(4)).to.equal(false);

    try {
      await preSale.connect(account1).buyTokens({ value: ether(1) });
    } catch (error) {
      expect(error.message).to.contain("Public sale is not open");
    }

    // open public sale
    await preSale.connect(treasury).openPublicSale(true);

    // buy tokens
    await testPurchase({
      account: account1,
      ethAmount: publicTier.maxAmount,
      expectedTokens: publicTier.maxAmount.mul(publicTier.tokensPerEth).div(ether(1)),
    });

    // close sale
    await preSale.connect(treasury).openPublicSale(false);
  });

  it("Should prevent whitelist purchasing until whitelist sale is enabled", async function () {
    // open whiltelist sale
    await preSale.connect(treasury).openWhitelistSale(1, true);
    expect(await preSale.isPublicSaleOpen()).to.equal(false);
    expect(await preSale.isWhitelistSaleOpen(1)).to.equal(true);
    expect(await preSale.isWhitelistSaleOpen(2)).to.equal(false);
    expect(await preSale.isWhitelistSaleOpen(3)).to.equal(false);
    expect(await preSale.isWhitelistSaleOpen(4)).to.equal(false);

    try {
      await preSale.connect(account1).buyTokens({ value: ether(1) });
    } catch (error) {
      expect(error.message).to.contain("Public sale is not open");
    }

    // add account2 to whitelist
    await preSale.connect(treasury).addToWhitelist([account2.address], tier1.tierId);

    // close white list sale
    await preSale.connect(treasury).openWhitelistSale(1, false);

    try {
      await preSale.connect(account2).buyTokens({ value: ether(1) });
    } catch (error) {
      expect(error.message).to.contain("Whitelist sale is not open");
    }

    // open whitelist sale and try a non whitelisted wallet
    await preSale.connect(treasury).openWhitelistSale(1, true);
    try {
      await preSale.connect(account1).buyTokens({ value: ether(1) });
    } catch (error) {
      expect(error.message).to.contain("Public sale is not open");
    }

    // attempt to spend less than min purchase amount
    try {
      await preSale.connect(account2).buyTokens({ value: tier1.minAmount.sub(1) });
    } catch (error) {
      expect(error.message).to.contain("Purchase amount too low");
    }

    // attempt to spend more than max purchase amount
    try {
      await preSale.connect(account2).buyTokens({ value: tier1.maxAmount.add(1) });
    } catch (error) {
      expect(error.message).to.contain("Purchase amount too high");
    }

    // spend max purchase amount
    await testPurchase({
      account: account2,
      ethAmount: tier1.maxAmount,
      expectedTokens: tier1.maxAmount.mul(tier1.tokensPerEth).div(ether(1)),
    });

    // try tier 2
    try {
      await preSale.connect(account3).buyTokens({ value: ether(1) });
    } catch (error) {
      expect(error.message).to.contain("Public sale is not open");
    }
    await preSale.connect(treasury).addToWhitelist([account3.address], tier2.tierId);
    try {
      await preSale.connect(account3).buyTokens({ value: ether(1) });
    } catch (error) {
      expect(error.message).to.contain("Whitelist sale is not open");
    }
    await preSale.connect(treasury).openWhitelistSale(2, true);
    await testPurchase({
      account: account3,
      ethAmount: tier2.maxAmount,
      expectedTokens: tier2.maxAmount.mul(tier2.tokensPerEth).div(ether(1)),
    });

    // try tier 3
    try {
      await preSale.connect(account4).buyTokens({ value: ether(1) });
    } catch (error) {
      expect(error.message).to.contain("Public sale is not open");
    }
    await preSale.connect(treasury).addToWhitelist([account4.address], tier3.tierId);
    try {
      await preSale.connect(account4).buyTokens({ value: ether(1) });
    } catch (error) {
      expect(error.message).to.contain("Whitelist sale is not open");
    }
    await preSale.connect(treasury).openWhitelistSale(3, true);
    await preSale.connect(treasury).addToWhitelist([account4.address], tier3.tierId);
    await testPurchase({
      account: account4,
      ethAmount: tier3.maxAmount,
      expectedTokens: tier3.maxAmount.mul(tier3.tokensPerEth).div(ether(1)),
    });
  });

  it("Should apply correct pricing if both whitelist and public sale are running", async function () {
    // open whiltelist + public sale
    await preSale.connect(treasury).openPublicSale(true);
    expect(await preSale.isPublicSaleOpen()).to.equal(true);
    expect(await preSale.isWhitelistSaleOpen(1)).to.equal(true);
    expect(await preSale.isWhitelistSaleOpen(2)).to.equal(true);
    expect(await preSale.isWhitelistSaleOpen(3)).to.equal(true);
    expect(await preSale.isWhitelistSaleOpen(4)).to.equal(false);

    // test public sale purchase (non-whitelisted)
    await testPurchase({
      account: account5,
      ethAmount: publicTier.maxAmount,
      expectedTokens: publicTier.maxAmount.mul(publicTier.tokensPerEth).div(ether(1)),
    });

    // add wallet to whitelist and test for whitelist pricing
    await preSale.connect(treasury).addToWhitelist([account6.address], tier1.tierId);
    await testPurchase({
      account: account6,
      ethAmount: tier1.maxAmount,
      expectedTokens: tier1.maxAmount.mul(tier1.tokensPerEth).div(ether(1)),
    });
  });

  it("Should allow for custom pricing tiers to be configured", async function () {
    // add custom tier - min:25, max:50, 2000 tokens per eth
    await preSale.connect(treasury).addCustomTier(99, ether(25), ether(50), ether(2000));
    await preSale.connect(treasury).openWhitelistSale(99, true);

    // add account to custom tier
    await preSale.connect(treasury).addToWhitelist([account7.address], 99);

    // check transaction
    await testPurchase({
      account: account7,
      ethAmount: ether(50),
      expectedTokens: ether(50 * 2000),
    });

    // reject any more transactions
    try {
      await preSale.connect(account7).buyTokens({ value: ether(25) });
    } catch (error) {
      expect(error.message).to.contain("Total purchases exceed limit");
    }

    // create another tier and move user to second tier
    // add custom tier - min:25, max:75, 2000 tokens per eth
    await preSale.connect(treasury).addCustomTier(100, ether(25), ether(75), ether(1000));
    await preSale.connect(treasury).openWhitelistSale(100, true);
    await preSale.connect(treasury).addToWhitelist([account7.address], 100);

    // check transaction
    await testPurchase({
      account: account7,
      ethAmount: ether(25),
      expectedTokens: ether(25 * 1000),
    });

    // reject any more transactions
    try {
      await preSale.connect(account7).buyTokens({ value: ether(25) });
    } catch (error) {
      expect(error.message).to.contain("Total purchases exceed limit");
    }
  });

  it("Should prevent users from unlocking tokens until after sale is finalized", async function () {
    try {
      await preSale.connect(account1).unlockTokens();
    } catch (error) {
      expect(error.message).to.contain("Sale is not closed yet");
    }
  });

  it("Should auto add liquidity and distribute funds when sale is finalized", async function () {
    // set soft cap to zero to force the sale to go through
    await preSale.connect(treasury).setSoftCap(0);
    await preSale.connect(treasury).setLockDuration(500);

    const ethCollected = await ethers.provider.getBalance(preSale.address);
    const tokensSold = await preSale.tokensSold();
    const treasuryEthBefore = await ethers.provider.getBalance(treasury.address);
    const treasuryTokensBefore = await token.balanceOf(treasury.address);
    const preSaleTokenBalanceBefore = await token.balanceOf(preSale.address);

    // check numbers
    expect(ethCollected).to.equal(ethSpent);
    expect(tokensSold).to.equal(tokensPurchased);

    // finalize sale
    // await token.connect(treasury).openTrade();
    const tx = await preSale.connect(treasury).finalizeSale();
    const gas = await gasUsed(tx);

    // calculate how much was sent to treasury
    const treasuryEthAfter = await ethers.provider.getBalance(treasury.address);
    const treasuryTokensAfter = await token.balanceOf(treasury.address);
    const treasuryEth = treasuryEthAfter.sub(treasuryEthBefore);

    const expectedLiquidityEth = ethCollected.mul(ether(60)).div(ether(100));
    const expectedLiquidityTokens = tokensSold.mul(ether(60)).div(ether(100));
    const expectedSafeExitEth = ethCollected.mul(ether(12)).div(ether(100));
    const expectedLrfEth = ethCollected.mul(ether(12)).div(ether(100));
    const expectedTreasuryEth = ethCollected.sub(expectedLiquidityEth).sub(expectedSafeExitEth).sub(expectedLrfEth);

    // check account balances
    expect(await ethers.provider.getBalance(await token.getLrfAddress())).to.equal(expectedLrfEth);
    expect(await ethers.provider.getBalance(await token.getSafeExitFundAddress())).to.equal(expectedSafeExitEth);
    expect(treasuryEth).to.equal(expectedTreasuryEth.sub(gas)); // account for gas to finalise sale

    const expectedLPtokens = calculateLPtokens({ tokenAmount: expectedLiquidityTokens, ethAmount: expectedLiquidityEth });

    // Treasury should have LP tokens after adding liquidity
    expect(await pair.balanceOf(treasury.address)).to.equal(expectedLPtokens);

    // Check eth/token reserves in DEX pair
    const { ethReserves, tokenReserves } = await getLiquidityReserves({ token, pair });
    expect(ethReserves).to.equal(expectedLiquidityEth);
    expect(tokenReserves).to.equal(expectedLiquidityTokens);

    // expect remaining tokens to be sent back to treasury
    const remainingTokens = preSaleTokenBalanceBefore.sub(expectedLiquidityTokens);
    expect(treasuryTokensAfter.sub(treasuryTokensBefore)).to.equal(remainingTokens);
    expect(await token.balanceOf(preSale.address)).to.equal(0);
  });

  it("Should allow users to unlock their purchased tokens", async function () {
    const tokenBalanceBefore = await token.balanceOf(account1.address);
    const lockerAddress = await preSale.locker(account1.address);
    const lockerTokenBalance = await token.balanceOf(lockerAddress);

    try {
      await preSale.connect(account1).unlockTokens();
    } catch (error) {
      expect(error.message).to.contain("Tokens cannot be unlocked yet");
    }

    // move time forward by 1 day
    await ethers.provider.send("evm_increaseTime", [500]);
    await ethers.provider.send("evm_mine");

    await preSale.connect(account1).unlockTokens();

    const lockerTokenBalanceAfter = await token.balanceOf(lockerAddress);
    const tokenBalanceAfter = await token.balanceOf(account1.address);
    const tokenAmount = tokenBalanceAfter.sub(tokenBalanceBefore);

    expect(tokenAmount).to.equal(lockerTokenBalance);
    expect(lockerTokenBalanceAfter).to.equal(0);
  });
});
