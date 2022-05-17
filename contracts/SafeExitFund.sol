// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";

contract SafeExitFund is ISafeExitFund, ERC721Enumerable {
  using SafeMath for uint256;
  using Counters for Counters.Counter;
  Counters.Counter private _tokenId;

  struct Package {
    uint256 insuranceAmount;
    uint256 randomRangeFrom;
    uint256 randomRangeTo;
    string metadataUri;
  }

  Package[] private packages;

  struct NftData {
    uint256 insuredAmount;
    uint256 overrideLimit;
    bool used; // one time use
  }

  mapping(uint256 => NftData) private nftData;

  uint256 private bonus = 625; // 6.25%

  uint256 public maxSupply = 5000;

  string public unrevealedUri = "";
  string public usedUri = "";

  uint256 private randomSeed = 123456789;
  uint256 private timestampSalt = 123456789;
  bool private randomSeedHasBeenSet = false;

  address private presaleContractAddress;
  mapping(address => uint256) private presaleBuyAmount;

  uint256 public activationDate;

  // GuilderFi token contract address
  IGuilderFi internal token;

  modifier onlyToken() {
    require(msg.sender == address(token), "Sender is not token contract");
    _;
  }

  modifier onlyTokenOwner() {
    require(msg.sender == address(token.getOwner()), "Sender is not token owner");
    _;
  }

  modifier onlyPresale() {
    require(msg.sender == token.getPreSaleAddress(), "Sender is not presale contract");
    _;
  }

  modifier nftsRevealed() {
    require(randomSeedHasBeenSet == true, "NFTs are not revealed yet");
    _;
  }

  constructor() ERC721("Safe Exit Fund", "SEF") {
    token = IGuilderFi(msg.sender);

    packages.push(Package(25 ether, 0, 24, "")); // PACK A, index 0
    packages.push(Package(10 ether, 25, 49, "")); // PACK B, index 1
    packages.push(Package(5 ether, 50, 74, "")); // PACK C, index 2
    packages.push(Package(1 ether, 75, 99, "")); // PACK D, index 3
  }

  /**
   * External function executed with every main contract transaction,
   * fills or drains NFTs 
   */
  function execute(
    address sender,
    address recipient,
    uint256 tokenAmount
  ) external onlyToken {
    // if sender == pair, then this is a buy transaction
    if (sender == token.getPair()) {
      uint256 ethAmount = tokenAmount; // TODO calculate eth amount based tokenAmount * current dex price
      fillNftsInWallet(recipient, ethAmount);
    }
    else {
      drainNftsInWallet(sender);
    }
  }

  /**
   * Gets a wallet address and an amount of coins to insure.
   * Tries to fill all the NFTs in the user's wallet insuring the amount.
   * Called by the token contract when a "buy" event occurs
   */
  function fillNftsInWallet(address _walletAddress, uint256 _amount) internal onlyToken {
    if (_amount <= 0) return;

    // loop through each NFT
    for (uint256 i = 0; i < balanceOf(_walletAddress); i++) {
      uint256 nftId = tokenOfOwnerByIndex(_walletAddress, i);

      (uint256 tokenInsuredAmount, uint256 tokenInsuranceTotal) = getNftInsurance(nftId);

      if (tokenInsuredAmount < tokenInsuranceTotal) {
        uint256 spaceLeft = tokenInsuranceTotal.sub(tokenInsuredAmount);

        if (_amount <= spaceLeft) {
          nftData[nftId].insuredAmount += _amount;
          return;
        }
        else {
          nftData[nftId].insuredAmount += spaceLeft;
          _amount -= spaceLeft;
        }
      }
    }
  }

  /**
   * Drains all the insured amount for a user.
   * Called by the token contract when a user transfers or sells any token.
   */
  function drainNftsInWallet(address _walletAddress) internal onlyToken {
    for (uint256 i = 0; i < balanceOf(_walletAddress); i++) {
      uint256 nftId = tokenOfOwnerByIndex(_walletAddress, i);
      drainNft(nftId);
    }
  }

  /**
   * Drain the insured amount of an NFT
   * Called on sell / transfer
   */
  function drainNft(uint256 _nftId) internal {
    nftData[_nftId].insuredAmount = 0;
    nftData[_nftId].overrideLimit = 0;
  }

  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 tokenId
  ) internal virtual override {
    super._beforeTokenTransfer(from, to, tokenId);

    drainNft(tokenId);
  }

  /**
   * Use all the NFTs in a user's wallet giving the insured amount to the user.
   * Called by the user in case they want the insured amount back
   */
  function claimSafeExit() external {
    require(block.timestamp > activationDate, "SafeExit not available yet");

    uint256 insuranceToRedeem = 0;

    for (uint256 i = 0; i < balanceOf(msg.sender); i++) {
      uint256 nftId = tokenOfOwnerByIndex(msg.sender, i);
      insuranceToRedeem += nftData[nftId].insuredAmount;
      nftData[nftId].insuredAmount = 0;
      nftData[nftId].used = true;
    }

    insuranceToRedeem = insuranceToRedeem + (insuranceToRedeem * bonus) / 100;
    payable(msg.sender).transfer(insuranceToRedeem);

    // TODO destroy all tokens in user's wallet.
  }

  function tokenURI(uint256 _nftId) public view virtual override returns (string memory) {
    require(_exists(_nftId), "Token does not exist");

    if (randomSeedHasBeenSet == false) {
      return unrevealedUri;
    }

    if (nftData[_nftId].used == true) {
      return usedUri;
    }

    return getPackage(_nftId).metadataUri;
  }

  function setMetadataUri(uint256 _packIndex, string memory _uri) external onlyTokenOwner {
    require(_packIndex <= packages.length, "NFT package index not found");

    packages[_packIndex].metadataUri = _uri;
  }

  function mint(address _walletAddress) external onlyPresale {
    uint256 tokenId = _tokenId.current();
    require(tokenId < maxSupply, "Can't mint more NFTs");
    _mint(_walletAddress, tokenId);
    _tokenId.increment();
  }

  /**
   * Saves the insurable amount of coin for the presale buy.
   * used to initialize the insured amount after the presale
   */
  function setPresaleBuyAmount(address _walletAddress, uint256 _amount) external onlyPresale {
    presaleBuyAmount[_walletAddress] = _amount;
  }

  /**
   * init the insured amount after the presale
   */
  function initInsuredAmountAfterPresale(address _walletAddress) external {
    fillNftsInWallet(_walletAddress, presaleBuyAmount[_walletAddress]);
    presaleBuyAmount[_walletAddress] = 0;
  }

  /**
   * Gets the package given a token ID.
   * Works with a random procedure after the nfts are revealed
   */
  function getPackage(uint256 _nftId) public view nftsRevealed returns (Package memory) {
    // using timestamp salt & random seed & nftId we get a pseudo random number between 0 and 99
    uint256 randomNum = uint256(keccak256(abi.encodePacked(timestampSalt, randomSeed, _nftId))) % 100;

    for (uint256 i = 0; i < packages.length; i++) {
      if (randomNum >= packages[i].randomRangeFrom && randomNum <= packages[i].randomRangeTo) {
        return packages[i];
      }
    }

    return Package(0, 0, 0, "");
  }

  /**
   * Overrides the limit of an NFT
   */
  function overrideNftLimit(uint256 _nftId, uint256 _limit) public onlyTokenOwner {
    nftData[_nftId].overrideLimit = _limit;
  }

  /**
   * Overrides the limit of a batch of NFTs
   */
  function overrideNftLimitBatch(uint256[] memory _nftIds, uint256[] memory _limits) external onlyTokenOwner {
    require(_nftIds.length == _limits.length, "Ids and Limits do not match");

    for (uint256 i = 0; i < _nftIds.length; i++) overrideNftLimit(_nftIds[i], _limits[i]);
  }

  /**
   * Gets the insurance amount of an NFT, and the total insurable
   */
  function getNftInsurance(uint256 _nftId) public view returns (uint256, uint256) {
    require(_exists(_nftId), "Token does not exist");

    if (nftData[_nftId].used == true) {
      return (0, 0);
    }

    if (nftData[_nftId].overrideLimit > 0) {
      return (
        nftData[_nftId].insuredAmount,
        nftData[_nftId].overrideLimit
      );
    }

    return (
      nftData[_nftId].insuredAmount,
      getPackage(_nftId).insuranceAmount
    );
  }

  /**
   * Gets the total insured amount of a user, and the total insurable
   */
  function getTotalUserInsurance(address _walletAddress) external view returns (uint256, uint256) {
    uint256 insuredAmount = 0;
    uint256 totalInsurable = 0;

    for (uint256 i = 0; i < balanceOf(_walletAddress); i++) {
      uint256 nftId = tokenOfOwnerByIndex(_walletAddress, i);
      (uint256 tokenInsuredAmount, uint256 tokenInsuranceTotal) = getNftInsurance(nftId);
      insuredAmount += tokenInsuredAmount;
      totalInsurable += tokenInsuranceTotal;
    }

    return (insuredAmount, totalInsurable);
  }

  // Should be set after pre-sales are complete
  // Trigerred by an external function from main contract
  function setRandomSeed(uint256 _randomSeed) external onlyToken {
    if (!randomSeedHasBeenSet) {
      randomSeed = _randomSeed;
      timestampSalt = block.timestamp;

      // ensure random seed can only be set once
      randomSeedHasBeenSet = true;
    }
  }

  function setActivationDate(uint256 _date) external onlyTokenOwner {
    activationDate = _date;
  }

  function withdraw(uint256 _amount) external override onlyTokenOwner {
    payable(msg.sender).transfer(_amount);
  }

  function withdrawTokens(address _token, uint256 _amount) external override onlyTokenOwner {
    IERC20(_token).transfer(msg.sender, _amount);
  }

  receive() external payable {}
}