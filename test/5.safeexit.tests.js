const { expect } = require("chai");
const { ethers } = require("hardhat");

const { ether, print, transferTokens, transferEth, buyTokensFromDexByExactEth, addLiquidity, gasUsed, MAX_INT, printStatus, getLiquidityReserves } = require("./helpers");
const { tier1, tier2, tier3, tier4, publicSale } = require("./helpers/data");

const TOKEN_NAME = "GuilderFi";

let token;
let router;
let pair;
let preSale;
let safeExit;
let treasury;
let account1;
let account2;
let account3;
let account4;
let account5;
let account6;
let account7;
let account8;

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
    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    pair = await ethers.getContractAt("IDexPair", await token.getPair());

    // send 27m tokens to presale contract
    await transferTokens({ token, from: treasury, to: preSale, amount: ether(27000000) });

    // add some eth to safe exit fund
    await transferEth({ from: treasury, to: safeExit, amount: ether(10) });

    // open trading
    await token.connect(treasury).openTrade();

    // Approve DEX to transfer
    await token.connect(treasury).approve(router.address, MAX_INT);

    // Add 10 million tokens + 10 eth into liquidity
    const tokenAmount = ether(10000000);
    const ethAmount = ether(10);
    await addLiquidity({
      router,
      from: treasury,
      token,
      tokenAmount,
      ethAmount,
    });
  });

  it("Should mint correct number of NFTs with each purchase", async function () {
    // check each tier1,2,3,public sale receives an NFT
    // open sale
    await preSale.connect(treasury).openPublicSale(true);
    await preSale.connect(treasury).openWhitelistSale(1, true);
    await preSale.connect(treasury).openWhitelistSale(2, true);
    await preSale.connect(treasury).openWhitelistSale(3, true);

    // add whitelist participants
    await preSale.connect(treasury).addToWhitelist([account1.address], tier1.tierId);
    await preSale.connect(treasury).addToWhitelist([account2.address], tier2.tierId);
    await preSale.connect(treasury).addToWhitelist([account3.address], tier3.tierId);

    // buy minimum for each tier
    await preSale.connect(account1).buyTokens({ value: tier1.minAmount });
    await preSale.connect(account2).buyTokens({ value: tier2.minAmount });
    await preSale.connect(account3).buyTokens({ value: tier3.minAmount });

    // check that 1 NFT has been minted for each account
    expect(await safeExit.balanceOf(account1.address)).to.equal(1);
    expect(await safeExit.balanceOf(account2.address)).to.equal(1);
    expect(await safeExit.balanceOf(account3.address)).to.equal(1);

    // buy up to maximum for each tier
    await preSale.connect(account1).buyTokens({ value: tier1.maxAmount.sub(tier1.minAmount) });
    await preSale.connect(account2).buyTokens({ value: tier2.maxAmount.sub(tier2.minAmount) });
    await preSale.connect(account3).buyTokens({ value: tier3.maxAmount.sub(tier3.minAmount) });

    // each account should still only have 1 NFT
    expect(await safeExit.balanceOf(account1.address)).to.equal(1);
    expect(await safeExit.balanceOf(account2.address)).to.equal(1);
    expect(await safeExit.balanceOf(account3.address)).to.equal(1);
  });

  it("Should fill the NFTs with each purchase during pre-sale", async function () {
    // buy fixed amount
    await preSale.connect(treasury).openWhitelistSale(4, true);
    await preSale.connect(treasury).addToWhitelist([account6.address], 4);
    await preSale.connect(account6).buyTokens({ value: ether(1) });

    // finalise sale
    await preSale.connect(treasury).setLockDuration(0);
    await preSale.connect(treasury).finalizeSale();

    // set random safe exit seed
    await safeExit.connect(treasury).setRandomSeed(123456);

    // approve safe exit to burn tokens
    await token.connect(account6).approve(safeExit.address, MAX_INT);

    // check previous eth balance
    const account6ethBalanceBefore = await ethers.provider.getBalance(account6.address);

    // claim safe exit
    const tx = await safeExit.connect(account6).claimSafeExit();
    const gas = await gasUsed(tx);

    // check eth balance has increased by correct amount
    const account6ethBalanceAfter = await ethers.provider.getBalance(account6.address);
    const account6ethPayout = account6ethBalanceAfter.sub(account6ethBalanceBefore);
    expect(account6ethPayout).to.equal(ether(1.0625).sub(gas)); // account for gas
    expect(await token.balanceOf(account6.address)).to.equal(0);
  });

  /*
  it("Should fill NFTs during post-sale when buying from exchange", async function () {
    // check eth balance before buying from exchange
    expect(await token.balanceOf(account7.address)).to.equal(0);

    // check eth balance before buying from exchange
    const ethBalanceBeforeBuy = await ethers.provider.getBalance(account7.address);

    console.log(await token.balanceOf(account7.address));
    // buy exact amount of eth worth of tokens from exchange
    const tx = await buyTokensFromDexByExactEth({ router, token, account: account7, ethAmount: ether(0.1) });
    const gas = await gasUsed(tx);

    console.log(await token.balanceOf(account7.address));

    const { ethReserves, tokenReserves } = await getLiquidityReserves({ token, pair });
    console.log(`LP - eth:         ${ethers.utils.formatEther(ethReserves, { comify: true })}`);
    console.log(`LP - tokens:      ${ethers.utils.formatEther(tokenReserves, { comify: true })}`);

    // check eth balance has reduced by 0.5 eth
    const ethBalanceAfterBuy = await ethers.provider.getBalance(account7.address);
    const ethSpent = ethBalanceBeforeBuy.sub(ethBalanceAfterBuy).sub(gas);
    expect(ethSpent).to.equal(ether(0.1)); // account for gas

    const status = await safeExit.connect(account7).getInsuranceStatus(account7.address);
    console.log(status);
  });

  it("Should fill NFTs during post-sale when buying from exchange", async function () {
    // check eth balance before buying from exchange
    const ethBalanceBeforeBuy = await ethers.provider.getBalance(account7.address);

    console.log(await token.balanceOf(account7.address));
    // buy exact amount of eth worth of tokens from exchange
    const tx = await buyTokensFromDexByExactEth({ router, token, account: account7, ethAmount: ether(0.5) });
    const gas = await gasUsed(tx);

    console.log(await token.balanceOf(account7.address));

    const { ethReserves, tokenReserves } = await getLiquidityReserves({ token, pair });
    console.log(`LP - eth:         ${ethers.utils.formatEther(ethReserves, { comify: true })}`);
    console.log(`LP - tokens:      ${ethers.utils.formatEther(tokenReserves, { comify: true })}`);

    // check eth balance has reduced by 0.5 eth
    const ethBalanceAfterBuy = await ethers.provider.getBalance(account7.address);
    const ethSpent = ethBalanceBeforeBuy.sub(ethBalanceAfterBuy).sub(gas);
    expect(ethSpent).to.equal(ether(0.5)); // account for gas

    // check previous eth balance before safe exit
    const ethBalanceBeforeSafeExit = await ethers.provider.getBalance(account7.address);
    const status = await safeExit.connect(account7).getInsuranceStatus(account7.address);
    console.log(status);

    // claim safe exit
    const txSafeExit = await safeExit.connect(account7).claimSafeExit();
    const gasSafeExit = await gasUsed(txSafeExit);

    // check eth balance has increased by correct amount (0.5 + 0.5) = 1 + premium (6.25)
    const ethBalanceAfterSafeExit = await ethers.provider.getBalance(account7.address);
    const ethPayout = ethBalanceAfterSafeExit.sub(ethBalanceBeforeSafeExit).add(gasSafeExit);
    // expect(ethPayout).to.equal(ether(1.0625).sub(gasSafeExit)); // account for gas
  });
  */
  /*
  it("Should clear NFT balance when transferred to another wallet", async function () {
    // buy tokens
    // check balance increases
  });

  it("Should allow user to claim safe exit using NFT", async function () {
    // todo
  });
  */

  // add tests for custom nft
  // approve contract to do transferFrom before burning when doing a claim
  // check metadata update
});
