const { expect } = require("chai");
const { ethers } = require("hardhat");
const { print, transferTokens, ether } = require("./helpers");

const TOKEN_NAME = "GuilderFi";

let token;
let treasury;
let account1;

describe(`Testing rebasing engine..`, function () {
  before(async function () {
    // Set up accounts
    [, treasury, account1] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    await token.deployed();

    // start rebasing
    await token.connect(treasury).openTrade();
    await token.connect(treasury).launchToken();

    // transfer 100 tokens to account1
    await transferTokens({ token, from: treasury, to: account1, amount: ether(100) });
  });

  it("Rebase should increase each account balance by 0.016% after 12 minutes", async function () {
    // move time forward 12 minutes
    await ethers.provider.send("evm_increaseTime", [720]);
    await ethers.provider.send("evm_mine");

    expect(await token.pendingRebases()).to.equal(1);

    // trigger rebase
    await token.connect(treasury).rebase();

    // check that rebase has been applied
    expect(await token.balanceOf(account1.address)).to.equal(ether(100.016030912247));
    expect(await token.lastEpoch()).to.equal(1);
    expect(await token.pendingRebases()).to.equal(0);
  });

  it("Rebase should perform rebases in max batch sizes", async function () {
    // move time forward by 100 rebases)
    await ethers.provider.send("evm_increaseTime", [720 * 100]);
    await ethers.provider.send("evm_mine");

    expect(await token.pendingRebases()).to.equal(100);

    // trigger rebase
    await token.connect(treasury).rebase();

    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(100.659379119725), ether(0.001));
    expect(await token.lastEpoch()).to.equal(41);
    expect(await token.pendingRebases()).to.equal(60);

    await token.connect(treasury).rebase();
    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.306865632955), ether(0.001));
    expect(await token.lastEpoch()).to.equal(81);
    expect(await token.pendingRebases()).to.equal(20);

    await token.connect(treasury).rebase();
    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.632169066129), ether(0.001));
    expect(await token.lastEpoch()).to.equal(101);
    expect(await token.pendingRebases()).to.equal(0);

    try {
      await token.connect(treasury).rebase();
    } catch (error) {
      expect(error.message).to.contain("No pending rebases");
    }

    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.632169066129), ether(0.001));
    expect(await token.lastEpoch()).to.equal(101);
    expect(await token.pendingRebases()).to.equal(0);
  });
});
