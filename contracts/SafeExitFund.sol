// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";
import "./interfaces/IDexPair.sol";
import "./interfaces/IPreSale.sol";
import "./interfaces/ILocker.sol";

contract SafeExitFund is ISafeExitFund, ERC721Enumerable {
  using SafeMath for uint256;
  using Counters for Counters.Counter;
  Counters.Counter private _tokenId;

  address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

  struct InsuranceStatus {
    uint256 walletPurchaseAmount;
    uint256 payoutAmount;
    uint256 maxInsuranceAmount;
    uint256 premiumAmount;
    uint256 finalPayoutAmount;
  }

  struct Package {
    uint256 packageId;
    string name;
    uint256 maxInsuranceAmount;
    string metadataUriActive;
    string metadataUriReady;
    string metadataUriDead;
  }

  struct PackageChancePercentage {
    uint256 packageId;
    uint256 chancePercentage;
  }

  mapping(uint256 => Package) private packages;
  PackageChancePercentage[] private packageChances;

  // bonus
  uint256 private bonusNumerator = 625; // 6.25%
  uint256 private constant BONUS_DENOMINATOR = 10000; 

  // max nft supply
  uint256 private _maxSupply = 5000;

  // metadata uri's
  string private _presaleMetadataUri = "";

  // lottery
  bool private randomSeedHasBeenSet = false;
  uint256 private randomSeed = 123456789;
  uint256 private timestampSalt = 123456789;

  // maps
  mapping(address => uint256) private purchaseAmount;
  mapping(uint256 => bool) private isUsed;
  mapping(uint256 => uint256) private _customPackage;

  // date when safeexit can be claimed
  uint256 private _activationDate;

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

  modifier onlyTokenOwnerOrPresale() {
    require(msg.sender == address(token.getOwner()) || msg.sender == token.getPreSaleAddress(), "Sender is not token or presale");
    _;
  }

  modifier nftsRevealed() {
    require(randomSeedHasBeenSet == true, "NFTs are not revealed yet");
    _;
  }

  constructor(address tokenAddress) ERC721("GuilderFi Safe Exit", "SAFEEXIT") {
    token = IGuilderFi(tokenAddress);

    // Set up initial NFT packages
    packages[1] = Package(
      1,
      "Noble",
      100 ether,
      "https://assets.guilderfi.io/safeexit/noble/active.json",
      "https://assets.guilderfi.io/safeexit/noble/ready.json",
      "https://assets.guilderfi.io/safeexit/noble/dead.json"
    );

    packages[2] = Package(
      2,
      "Artisan",
      25 ether,
      "https://assets.guilderfi.io/safeexit/artisan/active.json",
      "https://assets.guilderfi.io/safeexit/artisan/ready.json",
      "https://assets.guilderfi.io/safeexit/artisan/dead.json"
    );

    packages[3] = Package(
      3,
      "Clergy",
      10 ether,
      "https://assets.guilderfi.io/safeexit/clergy/active.json",
      "https://assets.guilderfi.io/safeexit/clergy/ready.json",
      "https://assets.guilderfi.io/safeexit/clergy/dead.json"
    );

    packages[4] = Package(
      4,
      "Merchant",
      5 ether,
      "https://assets.guilderfi.io/safeexit/merchant/active.json",
      "https://assets.guilderfi.io/safeexit/merchant/ready.json",
      "https://assets.guilderfi.io/safeexit/merchant/dead.json"
    );

    packages[5] = Package(
      5,
      "Guilder",
      1 ether,
      "https://assets.guilderfi.io/safeexit/guilder/active.json",
      "https://assets.guilderfi.io/safeexit/guilder/ready.json",
      "https://assets.guilderfi.io/safeexit/guilder/dead.json"
    );

    // Set % chances of receiving each NFT package
    packageChances.push(PackageChancePercentage(1, 1));
    packageChances.push(PackageChancePercentage(2, 10));
    packageChances.push(PackageChancePercentage(3, 15));
    packageChances.push(PackageChancePercentage(4, 25));
    packageChances.push(PackageChancePercentage(5, 49));
  }

  /**
   * External function executed with every main contract transaction,
   */
  function captureTransaction(
    address sender,
    address recipient,
    uint256 tokenAmount
  ) external override onlyToken {
    // if sender == pair, then this is a buy transaction
    if (sender == token.getPair()) {
      capturePurchaseAmount(recipient, tokenAmount);
    }
    else {
      // reset insured amount to zero when user sells/transfers tokens
      resetInsuredAmount(sender);
    }
  }

  /**
   * When a user purchases tokens from the exchange, calculate the current
   * price of the token (in eth/coins) and record it
   */
  function capturePurchaseAmount(address _walletAddress, uint256 _tokenAmount) internal onlyToken {
    if (_tokenAmount <= 0) return;

    (uint256 ethReserves, uint256 tokenReserves) = getLiquidityPoolReserves();
    
    // calculate eth spent based on current liquidity pool reserves
    uint256 ethSpent = _tokenAmount.mul(ethReserves).div(tokenReserves - _tokenAmount);

    purchaseAmount[_walletAddress] = purchaseAmount[_walletAddress].add(ethSpent);
  }

  function capturePresalePurchase(address _walletAddress, uint256 _amount) external override onlyPresale {
    purchaseAmount[_walletAddress] = purchaseAmount[_walletAddress].add(_amount);
  }

  function resetInsuredAmount(address _walletAddress) internal {
    purchaseAmount[_walletAddress] = 0;
  }

  /**
   * Use all the NFTs in a user's wallet giving the insured amount to the user.
   * Called by the user in case they want the insured amount back
   */
  function claimSafeExit() external override {
    require(block.timestamp > _activationDate, "SafeExit not available yet");

    (, , , , uint256 finalPayoutAmount) = getInsuranceStatus(msg.sender);

    require(finalPayoutAmount > 0, "Invalid payout amount");
    require(address(this).balance >= finalPayoutAmount, "Insufficient SafeExit funds");

    resetInsuredAmount(msg.sender);

    for (uint256 i = 0; i < balanceOf(msg.sender); i++) {
      uint256 nftId = tokenOfOwnerByIndex(msg.sender, i);
      isUsed[nftId] = true;
    }

    // transfer
    payable(msg.sender).transfer(finalPayoutAmount);

    // burn user's tokens (will need user to pre-approve safe exit to run transferFrom)
    token.transferFrom(msg.sender, DEAD, token.balanceOf(msg.sender));

    // burn any locked tokens
    IPreSale presale = IPreSale(token.getPreSaleAddress());
    address lockerAddress = presale.locker(msg.sender);
    
    if (lockerAddress != address(0)) {
      ILocker locker = ILocker(lockerAddress);
      locker.burn();
    }
  }

  function mintRandom(address _walletAddress) external override onlyTokenOwnerOrPresale {
    uint256 tokenId = _tokenId.current();
    // require(tokenId < _maxSupply, "Cannot mint more NFTs");
    
    if (tokenId < _maxSupply) {
      _mint(_walletAddress, tokenId);
      _tokenId.increment();
    }
  }

  function mint(address _walletAddress, uint256 _packageId) external override onlyTokenOwner {
    uint256 tokenId = _tokenId.current();
    _mint(_walletAddress, tokenId);
    _customPackage[tokenId] = _packageId;
    _tokenId.increment();
  }  

  function createPackage(
    uint256 _packageId,
    string memory _name,
    uint256 _maxInsuranceAmount,
    string memory _uriActive,
    string memory _uriReady,
    string memory _uriDead) external override onlyTokenOwner {
    packages[_packageId] = Package(_packageId, _name, _maxInsuranceAmount, _uriActive, _uriReady, _uriDead);
  }

  /**
   * Public getter functions
   */
  function maxSupply() public override view returns (uint256) { return _maxSupply; }
  function activationDate() public override view returns (uint256) { return _activationDate; }
  function issuedTokens() public override view returns (uint256) { return _tokenId.current(); }

  function tokenURI(uint256 _nftId) public view override(ISafeExitFund, ERC721) returns (string memory) {
    require(_exists(_nftId), "Token does not exist");

    if (!randomSeedHasBeenSet) {
      return _presaleMetadataUri;
    }

    (, , , string memory metadataUriActive, string memory metadataUriReady, string memory metadataUriDead) = getPackage(_nftId);

    if (isUsed[_nftId]) {
      return metadataUriDead;
    }

    (, , , , uint256 finalPayoutAmount) = getInsuranceStatus(ownerOf(_nftId));

    if (finalPayoutAmount > 0) {
      return metadataUriActive;
    }

    return metadataUriReady;
  }

  /**
   * Gets the package given a token ID.
   * The value of the package is determined via a random seed 
   */
  function getPackage(uint256 _nftId) public override view nftsRevealed returns (
    uint256 packageId,
    string memory name,
    uint256 maxInsuranceAmount,
    string memory metadataUriActive,
    string memory metadataUriReady,
    string memory metadataUriDead
  ) {
    // declare package
    Package memory package = Package(0, "", 0, "", "", "");
    
    // get custom assigned package if applicable
    if (_customPackage[_nftId] > 0) {
      package = packages[_customPackage[_nftId]];
    }

    // else get randomized package
    else {
      // using timestamp salt & random seed & nftId we get a pseudo random number between 0 and 99
      uint256 randomNum = uint256(keccak256(abi.encodePacked(timestampSalt, randomSeed, _nftId))) % 100;

      uint256 rangeFrom = 0;
      uint256 rangeTo = 0;

      for (uint256 i = 0; i < packageChances.length; i++) {
        rangeTo = rangeFrom + packageChances[i].chancePercentage;

        if (randomNum >= rangeFrom && randomNum < rangeTo) {
          // found matching package, return results
          package = packages[packageChances[i].packageId];
        }

        rangeFrom += packageChances[i].chancePercentage;
      }
    }
    
    packageId = package.packageId;
    name = package.name;
    maxInsuranceAmount = package.maxInsuranceAmount;
    metadataUriActive = package.metadataUriActive;
    metadataUriReady = package.metadataUriReady;
    metadataUriDead = package.metadataUriDead;

    return (packageId, name, maxInsuranceAmount, metadataUriActive, metadataUriReady, metadataUriDead);
  }

  function getInsuranceStatus(address _walletAddress) public override view nftsRevealed returns (
    uint256 totalPurchaseAmount,
    uint256 maxInsuranceAmount,
    uint256 payoutAmount,
    uint256 premiumAmount,
    uint256 finalPayoutAmount
    ) {
    
    totalPurchaseAmount = purchaseAmount[_walletAddress];
    maxInsuranceAmount = getTotalInsurance(_walletAddress);

    payoutAmount = (totalPurchaseAmount > maxInsuranceAmount) ? maxInsuranceAmount : totalPurchaseAmount;

    // add premium
    premiumAmount = payoutAmount.mul(bonusNumerator).div(BONUS_DENOMINATOR);
    finalPayoutAmount = payoutAmount.add(premiumAmount);
  }

  /**
   * Internal getter functions
   */
  function getTotalInsurance(address _walletAddress) internal view returns (uint256) {
    uint256 totalInsurance = 0;

    for (uint256 i = 0; i < balanceOf(_walletAddress); i++) {
      uint256 nftId = tokenOfOwnerByIndex(_walletAddress, i);

      // first check if NFT has been used
      if (!isUsed[nftId]) {

        // add insurance amount
        (,,uint256 maxInsuranceAmount,,,) = getPackage(nftId);
        totalInsurance = totalInsurance.add(maxInsuranceAmount);
      }
    }

    return totalInsurance;
  }

  function getLiquidityPoolReserves() internal view returns (uint256, uint256) {
    IDexPair pair = IDexPair(token.getPair());
    address token0Address = pair.token0();
    (uint256 token0Reserves, uint256 token1Reserves, ) = pair.getReserves();
    
    // returns eth reserves, token reserves
    return token0Address == address(token) ?
        (token1Reserves, token0Reserves) :
        (token0Reserves, token1Reserves);
  }

  /**
   * Launch Safe Exit - reveal all NFT packages using a random seed
   */
  function launchSafeExitNft(uint256 _randomSeed) external override onlyTokenOwner {
    // can only be called once
    if (!randomSeedHasBeenSet) {
      randomSeed = _randomSeed;
      timestampSalt = block.timestamp;

      // ensure random seed can only be set once
      randomSeedHasBeenSet = true;
    }
  }

  /**
   * Other external override setter functions
   */
  function setMaxSupply(uint256 newMaxSupply) external override onlyTokenOwner {
    _maxSupply = newMaxSupply;
  }

  function setMetadataUri(
    uint256 _packageId,
    string memory _uriActive,
    string memory _uriReady,
    string memory _uriDead) external override onlyTokenOwner {
    packages[_packageId].metadataUriActive = _uriActive;
    packages[_packageId].metadataUriReady = _uriReady;
    packages[_packageId].metadataUriDead = _uriDead;
  }

  function setPresaleMetadataUri(string memory _uri) external override onlyTokenOwner {
    _presaleMetadataUri = _uri;
  }

  function setActivationDate(uint256 _date) external override onlyTokenOwnerOrPresale {
    _activationDate = _date;
  }

  function withdraw(uint256 amount) external override onlyTokenOwner {
      payable(msg.sender).transfer(amount);
  }
  
  receive() external payable {}
}