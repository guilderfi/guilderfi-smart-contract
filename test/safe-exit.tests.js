const { expect } = require("chai");
const { ethers } = require("hardhat");

const { addZeroes, print } = require("./helpers");

const TOKEN_NAME = "GuilderFi";
const DECIMALS = 18;

let token;

let treasury;

describe(`Testing Pre-Sale and SafeExit..`, function () {
  before(async function () {
    // Set up accounts
    [, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    global.token = token;
    await token.deployed();
  });

  it("Should mint 100m tokens", async function () {
    // TODO - SafeExit and Pre-Sale tests
    expect(await token.totalSupply()).to.equal(addZeroes("100000000", DECIMALS));
    expect(await token.balanceOf(treasury.address)).to.equal(addZeroes("100000000", DECIMALS));
  });
});
