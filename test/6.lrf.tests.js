/*
const { expect } = require("chai");
const { ethers } = require("hardhat");

const { print } = require("./helpers");

const TOKEN_NAME = "GuilderFi";
const DECIMALS = 18;

let token;

let treasury;
let account1;
let lrf;
*/

describe(`Testing liquidity relief fund..`, function () {
  before(async function () {
    /*
    // Set up accounts
    [, treasury, account1] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    await token.deployed();

    // contracts
    lrf = await ethers.getContractAt("LiquidityReliefFund", await token.lrf());
    */
  });

  /*
  it("Should only become active when activation target has been met", async function () {
    // todo
    // trigger ratio -> 105%
    // hasReachedActivationTarget public?
  });

  it("Should buy tokens when backed liquidity > 100%", async function () {
    // todo
    // check balance has been adjusted
  });

  it("Should sell tokens when backed liquidity < 100%", async function () {
    // todo
    // check balance has been adjusted
  });

  it("Should not execute when backed liquidity > 115%", async function () {
    // todo
    // check balance has been adjusted
  });

  it("Should not execute when backed liquidity < 85%", async function () {
    // todo
    // check balance has been adjusted
  });
  */
});
