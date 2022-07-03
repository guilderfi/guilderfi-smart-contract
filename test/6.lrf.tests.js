const { expect } = require("chai");
const { ethers } = require("hardhat");

const { deploy } = require("../helpers/deploy");
const { MAX_INT, ether, print, createWallet } = require("../helpers/utils");
const { buyTokensFromDex, sellTokens, addLiquidity, transferEth } = require("../helpers");

let token;
let deployer;
let treasury;
let router;
let pair;
let lrf;

const account1 = createWallet(ethers);
const account2 = createWallet(ethers);
const account3 = createWallet(ethers);

describe.only(`Testing liquidity relief fund..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);
    token = await deploy({ ethers, deployer, treasury: account1 });

    // contracts
    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    pair = await ethers.getContractAt("IDexPair", await token.getPair());
    lrf = await ethers.getContractAt("LiquidityReliefFund", await token.getLrfAddress());

    // transfer some eth to test accounts
    await transferEth({ from: deployer, to: account1, amount: ether(5000) });
    await transferEth({ from: deployer, to: account2, amount: ether(10000) });
    await transferEth({ from: deployer, to: account3, amount: ether(10000) });

    await token.connect(account1).approve(router.address, MAX_INT);

    // Add 100k tokens + 500k BNB into liquidity
    const tokenAmount = ether(5000);
    const ethAmount = ether(2500);

    await addLiquidity({
      router,
      from: account1,
      token,
      tokenAmount,
      ethAmount,
    });
  });

  it("Should only become active when activation target has been met", async function () {
    expect(lrf.hasReachedActivationTarget).to.be.true();
  });

  it("Should buy tokens when backed liquidity > 100%", async function () {
    await sellTokens({ router, token, account: account1, tokenAmount: ether(500) });

    // Ensure ratio is above MIDPOINT
    const ratioBefore = await lrf.getBackedLiquidityRatio();
    expect(ratioBefore).to.gt(10000);

    const LRFBalanceBefore = await token.balanceOf(lrf.address);

    await lrf.connect(account1).execute();

    const ratioAfter = await lrf.getBackedLiquidityRatio();

    console.log("ratios", ratioBefore, ratioAfter);
    // Ensure ratio is back to MIDPOINT
    expect(ratioAfter).to.equal(10000);

    const LRFBalanceAfter = await token.balanceOf(lrf.address);

    // LRF should have increased token balance
    expect(LRFBalanceAfter.sub(LRFBalanceBefore)).to.gt(0);
    await buyTokensFromDex({ router, pair, token, account: account1, tokenAmount: ether(500) });
  });

  it("Should sell tokens when backed liquidity < 100%", async function () {
    await buyTokensFromDex({ router, pair, token, account: account1, tokenAmount: ether(500) });

    // Ensure ratio is below MIDPOINT
    const ratioBefore = await lrf.getBackedLiquidityRatio();
    expect(ratioBefore).to.lt(10000);

    const LRFBalanceBefore = await token.balanceOf(lrf.address);

    await lrf.connect(account1).execute();

    const ratioAfter = await lrf.getBackedLiquidityRatio();
    // Ensure ratio is back to MIDPOINT
    expect(ratioAfter).to.equal(10000);

    const LRFBalanceAfter = await token.balanceOf(lrf.address);

    // LRF should have decreased token balance
    expect(LRFBalanceAfter.sub(LRFBalanceBefore).lt(0));
    await sellTokens({ router, token, account: account1, tokenAmount: ether(500) });
  });

  it("Should not execute when backed liquidity > 115%", async function () {
    await sellTokens({ router, token, account: account1, tokenAmount: ether(500) });

    // Ensure ratio is above HIGH_CAP
    const ratioBefore = await lrf.getBackedLiquidityRatio();
    expect(ratioBefore).to.gt(11500);

    const LRFBalanceBefore = await token.balanceOf(lrf.address);

    await lrf.connect(account1).execute();

    const ratioAfter = await lrf.getBackedLiquidityRatio();

    // Ensure ratio is the same
    expect(ratioAfter).to.equal(ratioBefore);

    const LRFBalanceAfter = await token.balanceOf(lrf.address);

    // LRF should have the same token balance
    expect(LRFBalanceAfter).to.eq(LRFBalanceBefore);
    await buyTokensFromDex({ router, pair, token, account: account1, tokenAmount: ether(500) });
  });

  it("Should not execute when backed liquidity < 85%", async function () {
    await buyTokensFromDex({ router, pair, token, account: account1, tokenAmount: ether(500) });

    // Ensure ratio is below LOW_CAP
    const ratioBefore = await lrf.getBackedLiquidityRatio();
    expect(ratioBefore).to.lt(8500);

    const LRFBalanceBefore = await token.balanceOf(lrf.address);

    await lrf.connect(account1).execute();

    const ratioAfter = await lrf.getBackedLiquidityRatio();

    // Ensure ratio is the same
    expect(ratioAfter).to.equal(ratioBefore);

    const LRFBalanceAfter = await token.balanceOf(lrf.address);

    // LRF should have the same token balance
    expect(LRFBalanceAfter).to.eq(LRFBalanceBefore);
    await sellTokens({ router, token, account: account1, tokenAmount: ether(500) });
  });
});
