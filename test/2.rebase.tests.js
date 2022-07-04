const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deploy } = require("../helpers/deploy");
const { ether, print, createWallet } = require("../helpers/utils");
const { transferTokens, transferEth, getPendingRebases, buyTokensFromDex, addLiquidity, MAX_INT } = require("../helpers");

let token;
let router;
let pair;
let deployer;
let treasury;

const account1 = createWallet(ethers);

describe(`Testing rebasing engine..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);
    token = await deploy({ ethers, deployer, treasury });

    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    pair = await ethers.getContractAt("IDexPair", await token.getPair());

    // Approve DEX to transfer
    await token.connect(treasury).approve(router.address, MAX_INT);

    // Add 10 million tokens + 10 eth into liquidity
    const tokenAmount = ether(100);
    const ethAmount = ether(100);
    await addLiquidity({
      router,
      from: treasury,
      token,
      tokenAmount,
      ethAmount,
    });

    // start rebasing
    await token.connect(treasury).launchToken();

    // transfer 100 tokens to account1
    await transferTokens({ token, from: treasury, to: account1, amount: ether(100) });

    // transfer some eth to test accounts
    await transferEth({ from: deployer, to: account1, amount: ether(10) });
  });

  it("Rebase should increase each account balance by 0.016% after 12 minutes", async function () {
    expect(await getPendingRebases({ ethers, token })).to.equal(0);

    // move time forward 12 minutes
    await ethers.provider.send("evm_increaseTime", [720]);
    await ethers.provider.send("evm_mine");

    expect(await getPendingRebases({ ethers, token })).to.equal(1);

    // trigger rebase
    await token.connect(treasury).rebase();

    // check that rebase has been applied
    expect(await token.balanceOf(account1.address)).to.equal(ether(100.016030912247));
    expect(await token.lastEpoch()).to.equal(1);
    expect(await getPendingRebases({ ethers, token })).to.equal(0);
  });

  it("Should auto rebase with transactions", async function () {
    // move time forward 12 minutes
    await ethers.provider.send("evm_increaseTime", [720]);
    await ethers.provider.send("evm_mine");

    expect(await getPendingRebases({ ethers, token })).to.equal(1);

    // make sure auto rebase is on
    expect(await token.isAutoRebaseEnabled()).to.equal(true);

    // trigger rebase
    // await token.connect(treasury).rebase();
    await buyTokensFromDex({ router, pair, token, account: account1, tokenAmount: ether(1) });
    // await token.connect(account1).approve(router.address, MAX_INT);
    // await sellTokens({ router, token, account: account1, tokenAmount: ether(1) });
    // await transferTokens({ token, from: account1, to: treasury, amount: ether(1) });

    // check that rebase has been applied
    expect(await token.lastEpoch()).to.equal(2);
    // expect(await token.balanceOf(account1.address)).to.be.greaterThan(ether(100.016030912247));
    expect(await getPendingRebases({ ethers, token })).to.equal(0);
  });

  it("Rebase should perform rebases in max batch sizes", async function () {
    // move time forward by 99 rebases)
    await ethers.provider.send("evm_increaseTime", [720 * 99]);
    await ethers.provider.send("evm_mine");

    expect(await getPendingRebases({ ethers, token })).to.equal(99);

    // trigger rebase
    await token.connect(treasury).rebase();

    // expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(100.659379119725), ether(0.001));
    expect(await token.lastEpoch()).to.equal(42);
    expect(await getPendingRebases({ ethers, token })).to.equal(59);

    await token.connect(treasury).rebase();
    // expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.306865632955), ether(0.001));
    expect(await token.lastEpoch()).to.equal(82);
    expect(await getPendingRebases({ ethers, token })).to.equal(19);

    await token.connect(treasury).rebase();
    // expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.632169066129), ether(0.001));
    expect(await token.lastEpoch()).to.equal(101);
    expect(await getPendingRebases({ ethers, token })).to.equal(0);

    try {
      await token.connect(treasury).rebase();
    } catch (error) {
      expect(error.message).to.contain("No pending rebases");
    }

    // expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.632169066129), ether(0.001));
    expect(await token.lastEpoch()).to.equal(101);
    expect(await getPendingRebases({ ethers, token })).to.equal(0);
  });
});
