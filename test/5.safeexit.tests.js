const { expect } = require("chai");
const { ethers } = require("hardhat");

const { ether, print, transferTokens, transferEth } = require("./helpers");
const { tier1, tier2, tier3, publicTier, customTier } = require("./helpers/data");

const TOKEN_NAME = "GuilderFi";

let token;

let treasury;
let account1;
let account2;
let account3;
let account4;
let account5;
let account6;
let account7;
let account8;
let preSale;
let safeExit;

describe(`Testing safe exit..`, function () {
  before(async function () {
    // Set up accounts
    [, treasury, account1, account2, account3, account4, account5, account6, account7, account8] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    await token.deployed();

    // contracts
    preSale = await ethers.getContractAt("PreSale", await token.preSale());
    safeExit = await ethers.getContractAt("SafeExitFund", await token.safeExitFund());

    // send 27m tokens to presale contract
    await transferTokens({ token, from: treasury, to: preSale, amount: ether(27000000) });

    // add some eth to safe exit fund
    await transferEth({ from: treasury, to: safeExit, amount: ether(10) });
  });

  it("Should mint correct number of NFTs with each purchase", async function () {
    // check each tier1,2,3,public sale receives an NFT
    // open sale
    await preSale.connect(treasury).openPublicSale(true);
    await preSale.connect(treasury).openWhitelistSale(true);

    // add whitelist participants
    await preSale.connect(treasury).addToWhitelist([account1.address], tier1.tierId);
    await preSale.connect(treasury).addToWhitelist([account2.address], tier2.tierId);
    await preSale.connect(treasury).addToWhitelist([account3.address], tier3.tierId);
    await preSale.connect(treasury).setCustomLimit([account4.address], ether(50));

    // buy minimum for each tier
    await preSale.connect(account1).buyTokens({ value: tier1.minAmount });
    await preSale.connect(account2).buyTokens({ value: tier2.minAmount });
    await preSale.connect(account3).buyTokens({ value: tier3.minAmount });
    await preSale.connect(account4).buyTokens({ value: customTier.minAmount });
    await preSale.connect(account5).buyTokens({ value: publicTier.minAmount });

    // check that 1 NFT has been minted for each account
    expect(await safeExit.balanceOf(account1.address)).to.equal(1);
    expect(await safeExit.balanceOf(account2.address)).to.equal(1);
    expect(await safeExit.balanceOf(account3.address)).to.equal(1);
    expect(await safeExit.balanceOf(account4.address)).to.equal(1);
    expect(await safeExit.balanceOf(account5.address)).to.equal(1);

    // buy up to maximum for each tier
    await preSale.connect(account1).buyTokens({ value: tier1.maxAmount.sub(tier1.minAmount) });
    await preSale.connect(account2).buyTokens({ value: tier2.maxAmount.sub(tier2.minAmount) });
    await preSale.connect(account3).buyTokens({ value: tier3.maxAmount.sub(tier3.minAmount) });
    // await preSale.connect(account4).buyTokens({ value: publicTier.maxAmount.sub(publicTier.minAmount) });
    // await preSale.connect(account5).buyTokens({ value: ether(50).sub(customTier.minAmount) });

    // each account should still only have 1 NFT
    expect(await safeExit.balanceOf(account1.address)).to.equal(1);
    expect(await safeExit.balanceOf(account2.address)).to.equal(1);
    expect(await safeExit.balanceOf(account3.address)).to.equal(1);
    expect(await safeExit.balanceOf(account4.address)).to.equal(1);
    expect(await safeExit.balanceOf(account5.address)).to.equal(1);
  });

  it("Should fill the NFTs with each purchase during pre-sale", async function () {
    // buy fixed amount
    await preSale.connect(account6).buyTokens({ value: ether(1) });
    await preSale.connect(account7).buyTokens({ value: ether(0.5) });
    await preSale.connect(account8).buyTokens({ value: ether(0.5) });

    // finalise sale
    await preSale.connect(treasury).setLockDuration(0);
    await preSale.connect(treasury).finalizeSale();

    // set random safe exit seed
    await safeExit.connect(treasury).setRandomSeed(123456);

    // check previous eth balance
    const account6ethBalanceBefore = await ethers.provider.getBalance(account6.address);

    // claim safe exit
    await safeExit.connect(account6).claimSafeExit();

    // check eth balance has increased by correct amount
    const account6ethBalanceAfter = await ethers.provider.getBalance(account6.address);
    const account6ethPayout = account6ethBalanceAfter.sub(account6ethBalanceBefore);
    expect(account6ethPayout).to.be.closeTo(ether(1.0625), ether(0.01)); // account for gas

    // check balance of each NFT above
    // buy more tokens, check balance again
  });

  /*
  it("Should allocate NFT values using random seed", async function () {
    // apply random seed
    // check package for each wallet
  });

  it("Should fill NFTs during post-sale when buying from exchange", async function () {
    // buy tokens
    // check balance increases
  });

  it("Should clear NFT balance when transferred to another wallet", async function () {
    // buy tokens
    // check balance increases
  });

  it("Should allow user to claim safe exit using NFT", async function () {
    // todo
  });

  // add tests for custom nft

  // approve contract to do transferFrom before burning when doing a claim
  // check metadata update
  */
});
