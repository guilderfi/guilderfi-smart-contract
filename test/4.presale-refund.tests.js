const { expect } = require("chai");
const { ethers } = require("hardhat");

const { ether, print, transferTokens } = require("./helpers");

const TOKEN_NAME = "GuilderFi";

let token;
let treasury;
let preSale;

describe(`Testing pre-sale refund scenario..`, function () {
  before(async function () {
    // Set up accounts
    [, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    await token.deployed();

    // contracts
    preSale = await ethers.getContractAt("PreSale", await token.preSale());

    // send 27m tokens to presale contract
    await transferTokens({ token, from: treasury, to: preSale, amount: ether(27000000) });
  });

  it("Should allow users to claim redunds when soft cap is not met", async function () {
    // todo
    expect(true);
  });
});
