// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";
import "./interfaces/ILocker.sol";
import "./interfaces/IDexRouter.sol";
import "./interfaces/IPreSale.sol";
import "./Locker.sol";

contract PreSale is IPreSale {

  using SafeMath for uint256;

  struct Tier {
    uint256 tierId;
    string name;
    uint256 minAmount;
    uint256 maxAmount;
    uint256 tokensPerEth;
    uint256 cap;
  }

  // tiers
  Tier private tier1 = Tier(1, "Noble", 12.5 ether, 25 ether, 1760, 500);
  Tier private tier2 = Tier(2, "Clergy", 5 ether, 10 ether, 1664, 1000);
  Tier private tier3 = Tier(3, "Artisan", 2.5 ether, 5 ether, 1600, 1000);
  Tier private publicSale = Tier(0, "Commoner", 0.5 ether, 1 ether, 1400, 2500);
  Tier private customTier = Tier(99, "Custom", 25 ether, MAX_UINT256, 2000, MAX_UINT256);
  
  // tiers array
  Tier[] private tiers;

  // constants
  uint256 private constant MAX_UINT256 = ~uint256(0);

  // maps/arrays
  mapping(address => uint256) private whitelist;
  mapping(address => uint256) private customBuyLimit;
  mapping(address => ILocker) private _lockers;
  mapping(address => uint256) private _purchaseAmount;
  mapping(address => bool) private _refundClaimed;

  // settings
  bool private _isPublicSaleOpen = false;
  bool private _isWhitelistSaleOpen = false;
  uint256 private _softCap = 10000 ether;
  uint256 private _publicSaleCloseDate;
  uint256 private _whitelistSaleCloseDate;
  uint256 private _lockerUnlockDate;

  // flags
  bool private _isRefundActivated = false;

  // contracts
  IGuilderFi private _token;

  modifier onlyTokenOwner() {
    require(msg.sender == address(_token.getOwner()), "Sender is not _token owner");
    _;
  }

  constructor() {
    _token = IGuilderFi(msg.sender);

    tiers.push(tier1);
    tiers.push(tier2);
    tiers.push(tier3);
    tiers.push(publicSale);
    tiers.push(customTier);
  }

  /**
   * Given a wallet address, return the tier information for that wallet
   * If tierId = 0, this means the wallet is not white listed and should
   * be treated as a public sale participant.
   */
  function getTier(address _address) private view returns (Tier memory) {
    uint256 _tierId = whitelist[_address];

    if (_tierId == 0) {
      return publicSale;
    }

    // loop through tiers
    for (uint256 i = 0; i< tiers.length; i++) {
      Tier memory tier = tiers[i];

      // find matching tier
      if (tier.tierId == _tierId) {
        
        // if custom tier, update buy limit
        if (tier.tierId == customTier.tierId) {
          tier.maxAmount = customBuyLimit[_address];
        }

        return tier;
      }
    }

    // default to public sale if no matching tier found
    return publicSale;
  }

  /**
   * Buy tokens - number of tokens determined by tier
   */
  function buyTokens() public payable {
    
    bool isPublicSaleActive = _isPublicSaleOpen; // && (_publicSaleCloseDate == 0 || block.timestamp < _publicSaleCloseDate);
    bool isWhitelistSaleActive = _isWhitelistSaleOpen && (_whitelistSaleCloseDate == 0 || block.timestamp < _whitelistSaleCloseDate);

    Tier memory tier = isWhitelistSaleActive ? getTier(msg.sender) : publicSale;

    if (isWhitelistSaleActive && !isPublicSaleActive) {
      require (tier.tierId > 0, "Wallet is not whitelisted");
    }
    
    if (!isWhitelistSaleActive && tier.tierId == 0) {
      require(isPublicSaleActive, "Pre sale is not open");
    }

    require(_purchaseAmount[msg.sender].add(msg.value) <= tier.maxAmount, "Total purchases exceed limit");
    require(msg.value >= tier.minAmount, "Purchase amount too low");
    require(msg.value <= tier.maxAmount, "Purchase amount too high");

    uint256 tokenAmount = msg.value.mul(tier.tokensPerEth);

    require(_token.balanceOf(address(this)) >= tokenAmount, "Presale requires more tokens");

    bool isFirstPurchase = _purchaseAmount[msg.sender] == 0;
    _purchaseAmount[msg.sender] = _purchaseAmount[msg.sender].add(msg.value);

    // check if locker exists
    ILocker userLocker = _lockers[msg.sender];

    if (address(userLocker) == address(0)) {
      // create a new locker
      userLocker = new Locker(address(this), msg.sender);
      _lockers[msg.sender] = userLocker;
    }

    // calculate tokens to lock (50%)
    uint256 tokensToLock = tokenAmount.div(2);
    uint256 tokensToTransfer = tokenAmount.sub(tokensToLock);

    // deposit half tokens into the locker
    _token.transfer(address(userLocker), tokensToLock);

    // sending half tokens to the user
    _token.transfer(msg.sender, tokensToTransfer);

    // gift a safe exit NFT if its the first time buying
    if (isFirstPurchase) {
      ISafeExitFund _safeExit = ISafeExitFund(_token.getSafeExitFundAddress());
      _safeExit.mint(msg.sender);
      _safeExit.setPresaleBuyAmount(msg.sender, msg.value);
    }
  }

  /**
   * Finalise pre-sale and distribute funds:
   * - Liquidity pool: 60%
   * - Treasury: 16%
   * - Safe Exit Fund: 12%
   * - Liquidity Relief Fund: 12%
   * 
   * If soft cap is not reached, allow participants to claim a refund
   */
  function finalizeSale() override external onlyTokenOwner {
    // if soft cap reached, distribute to other contracts
    uint256 totalEth = address(this).balance;

    if (totalEth < _softCap) {
      _isRefundActivated = true;
    }
    else {
      // distribute 60% to liquidity pool
      uint256 liquidityEthAmount = totalEth.mul(60 ether).div(100 ether);
      uint256 liquidityTokenAmount = 10000; // TODO - calculate _token amount

      IDexRouter router = IDexRouter(_token.getRouter());
      router.addLiquidityETH{value: liquidityEthAmount} (
        address(_token),
        liquidityTokenAmount,
        0,
        0,
        _token.getTreasuryAddress(),
        block.timestamp
      );

      // distribute 12% to safe exit fund
      uint256 safeExitEthAmount = totalEth.mul(12 ether).div(100 ether);
      payable(_token.getSafeExitFundAddress()).transfer(safeExitEthAmount);

      // distribute 12% to liquidity relief fund (LRF)
      uint256 lrfEthAmount = totalEth.mul(12 ether).div(100 ether);
      payable(_token.getLrfAddress()).transfer(lrfEthAmount);

      // distribute remaining 16% to treasury
      uint256 treasuryEthAmount = totalEth.sub(liquidityEthAmount).sub(safeExitEthAmount).sub(lrfEthAmount);
      payable(_token.getTreasuryAddress()).transfer(treasuryEthAmount);            
    }
  }

  /**
   * Claim refund
   */
  function claimRefund() override external returns (bool) {
    require(_isRefundActivated, "Refunds are not available");
    require(!_refundClaimed[msg.sender], "Refund already claimed");
    
    uint256 refundEthAmount = _purchaseAmount[msg.sender];
    (bool success,) = payable(msg.sender).call{ value: refundEthAmount }("");
    return success;
  }

  /**
   * Unlock tokens in user locker
   */
  function unlockTokens() override external {
    require(block.timestamp >= _lockerUnlockDate, "Tokens cannot be unlocked yet");

    ILocker userLocker = _lockers[msg.sender];
    userLocker.withdraw(msg.sender);
  }

  /**
   * Public getter functions
   */
  function token() public view override returns (address) { return address(_token); }
  function isPublicSaleOpen() public view override returns (bool) { return _isPublicSaleOpen; }
  function isWhitelistSaleOpen() public view override returns (bool) { return _isWhitelistSaleOpen; }
  function softCap() public view override returns (uint256) { return _softCap; }
  function publicSaleCloseDate() public view override returns (uint256) { return _publicSaleCloseDate; }
  function whitelistSaleCloseDate() public view override returns (uint256) { return _whitelistSaleCloseDate; }
  function lockerUnlockDate() public view override returns (uint256) { return _lockerUnlockDate; }
  function isRefundActivated() public view override returns (bool) { return _isRefundActivated; }
  function purchaseAmount(address _address) public view override returns (uint256) { return _purchaseAmount[_address]; }
  function refundClaimed(address _address) public view override returns (bool) { return _refundClaimed[_address]; }
  function locker(address _address) public view override returns (address) { return address(_lockers[_address]); }
  
  /**
   * External setter functions
   */
  function openPublicSale(bool isOpen) override external onlyTokenOwner {
    _isPublicSaleOpen = isOpen;
  }

  function openWhitelistSale(bool isOpen) override external onlyTokenOwner {
    _isWhitelistSaleOpen = isOpen;
  }

  function setSoftCap(uint256 softCapAmount) override external onlyTokenOwner {
    _softCap = softCapAmount;
  }

  function setPublicSaleCloseDate(uint256 date) override external onlyTokenOwner {
    _publicSaleCloseDate = date;
  }

  function setWhitelistSaleCloseDate(uint256 date) override external onlyTokenOwner {
    _whitelistSaleCloseDate = date;
  }

  function setLockerUnlockDate(uint256 date) override external onlyTokenOwner {
    _lockerUnlockDate = date;
  }

  function addToWhitelist(address[] memory _addresses, uint256 _tierId) override external onlyTokenOwner {
    require(_tierId == 1 || _tierId == 2 || _tierId == 3, "Invalid tier selected");
    for (uint256 i = 0; i < _addresses.length; i++) {
      whitelist[_addresses[i]] = _tierId;
    }
  }

  function removeFromWhitelist(address[] memory _addresses) override external onlyTokenOwner {
    for (uint256 i = 0; i < _addresses.length; i++) {
      whitelist[_addresses[i]] = 0;
    }
  }

  function setCustomLimit(address _address, uint256 _limit) override external onlyTokenOwner {
    whitelist[_address] = customTier.tierId;
    customBuyLimit[_address] = _limit;
  }
}