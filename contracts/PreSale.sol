// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";
import "./interfaces/ILocker.sol";
import "./interfaces/IDexRouter.sol";
import "./interfaces/IPreSale.sol";
import "./interfaces/ISafeExitFund.sol";
import "./Locker.sol";

contract PreSale is IPreSale {

  using SafeMath for uint256;

  struct Tier {
    uint256 tierId;
    uint256 minAmount;
    uint256 maxAmount;
    uint256 tokensPerEth;
  }

  // tiers
  Tier private tier1 = Tier(1, 37.5 ether, 125 ether, 731.71 ether);
  Tier private tier2 = Tier(2, 7.5 ether, 25 ether, 750 ether);
  Tier private tier3 = Tier(3, 1.5 ether, 5 ether, 769.23 ether);
  Tier private tier4 = Tier(4, 0.3 ether, 1 ether, 789.47 ether);
  Tier private publicSale = Tier(0, 3 ether, 10 ether, 759.49 ether);
  
  // tiers array
  Tier[] private tiers;

  // constants
  uint256 private constant MAX_UINT256 = ~uint256(0);

  // maps/arrays
  mapping(address => uint256) private whitelist;
  mapping(address => ILocker) private _lockers;
  mapping(address => uint256) private _purchaseAmount;
  mapping(address => bool) private _refundClaimed;

  // settings
  mapping(uint256 => bool) private _isSaleOpen;
  mapping(uint256 => uint256) private _saleCaps;
  mapping(uint256 => uint256) private _saleCloseDates;

  uint256 private _softCap = 10000 ether;
  uint256 private _lockDuration = 30 days;

  // flags
  bool private _isRefundActivated = false;
  uint256 private _tokensSold = 0;
  bool private _isSaleClosed = false;
  uint256 private _saleCloseDate;

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
    tiers.push(tier4);
    tiers.push(publicSale);
  }

  /**
   * Given a wallet address, return the tier information for that wallet
   * If tierId = 0, this means the wallet is not white listed and should
   * be treated as a public sale participant.
   */
  function getTier(address _address) public view returns (
    uint256 tierId,
    uint256 minAmount,
    uint256 maxAmount,
    uint256 tokensPerEth
  ) {
    uint256 _tierId = whitelist[_address];

    // loop through tiers
    for (uint256 i = 0; i< tiers.length; i++) {
      Tier memory tier = tiers[i];

      // find matching tier
      if (tier.tierId == _tierId) {
        return (
          tier.tierId,
          tier.minAmount,
          tier.maxAmount,
          tier.tokensPerEth
        );
      }
    }

    // default to public sale if no matching tier found
    return (
      publicSale.tierId,
      publicSale.minAmount,
      publicSale.maxAmount,
      publicSale.tokensPerEth
    );
  }

  /**
   * Buy tokens - number of tokens determined by tier
   */
  function buyTokens() public payable {
    require(!_isSaleClosed, "Sale is closed");

    (uint256 tierId, uint256 minAmount, uint256 maxAmount, uint256 tokensPerEth) = getTier(msg.sender);

    bool _isSaleActive = _isSaleOpen[tierId] &&
      (_saleCloseDates[tierId] == 0 || block.timestamp < _saleCloseDates[tierId]);

    require(_isSaleActive, tierId == 0 ? "Public sale is not open" : "Whitelist sale is not open");
    require(msg.value >= minAmount, "Purchase amount too low");
    require(msg.value <= maxAmount, "Purchase amount too high");
    require(_purchaseAmount[msg.sender].add(msg.value) <= maxAmount, "Total purchases exceed limit");

    uint256 tokenAmount = msg.value.mul(tokensPerEth).div(1 ether);
    _tokensSold = _tokensSold.add(tokenAmount);

    require(_token.balanceOf(address(this)) >= tokenAmount, "Presale requires more tokens");

    bool isFirstPurchase = _purchaseAmount[msg.sender] == 0;
    _purchaseAmount[msg.sender] = _purchaseAmount[msg.sender].add(msg.value);

    // check if locker exists
    ILocker userLocker = _lockers[msg.sender];

    if (address(userLocker) == address(0)) {
      // create a new locker
      userLocker = new Locker(address(this), address(_token));
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
      _safeExit.mintRandom(msg.sender);
      _safeExit.capturePresalePurchaseAmount(msg.sender, msg.value);
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

    _isSaleClosed = true;
    _saleCloseDate = block.timestamp;

    if (totalEth < _softCap) {
      _isRefundActivated = true;
    }
    else {
      // distribute 60% to liquidity pool
      uint256 liquidityEthAmount = totalEth.mul(60 ether).div(100 ether);
      uint256 liquidityTokenAmount = _tokensSold.mul(60 ether).div(100 ether);

      require(liquidityTokenAmount <= _token.balanceOf(address(this)), "Insufficient liquidity tokens");

      IDexRouter router = IDexRouter(_token.getRouter());
      router.addLiquidityETH{value: liquidityEthAmount} (
        address(_token),
        liquidityTokenAmount,
        0,
        0,
        _token.getTreasuryAddress(),
        block.timestamp
      );

      ISafeExitFund safeExitFund = ISafeExitFund(_token.getSafeExitFundAddress());

      // distribute 12% to safe exit fund
      uint256 safeExitEthAmount = totalEth.mul(12 ether).div(100 ether);
      payable(address(safeExitFund)).transfer(safeExitEthAmount);

      // set safe exit activation date for 30 days
      safeExitFund.setActivationDate(block.timestamp + 30 days);

      // distribute 12% to liquidity relief fund (LRF)
      uint256 lrfEthAmount = totalEth.mul(12 ether).div(100 ether);
      payable(_token.getLrfAddress()).transfer(lrfEthAmount);

      // distribute remaining 16% to treasury
      uint256 treasuryEthAmount = totalEth.sub(liquidityEthAmount).sub(safeExitEthAmount).sub(lrfEthAmount);
      payable(_token.getTreasuryAddress()).transfer(treasuryEthAmount);

      // refund remaining tokens to treasury
      _token.transfer(_token.getTreasuryAddress(), _token.balanceOf(address(this)));
    }
  }

  /**
   * Claim refund
   */
  function claimRefund() override external returns (bool) {
    require(_isSaleClosed, "Sale is not closed");
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
    require(_isSaleClosed, "Sale is not closed yet");
    require(block.timestamp >= _saleCloseDate + _lockDuration, "Tokens cannot be unlocked yet");

    ILocker userLocker = _lockers[msg.sender];
    userLocker.withdraw(msg.sender);
  }

  /**
   * Cancel sale
   */
  function cancelSale() override external onlyTokenOwner {
    _isSaleClosed = true;
    _saleCloseDate = block.timestamp;
    _isRefundActivated = true;
  }

  /**
   * Public getter functions
   */
  function token() public view override returns (address) { return address(_token); }
  function isPublicSaleOpen() public view override returns (bool) { return _isSaleOpen[0]; }
  function isWhitelistSaleOpen(uint256 tierId) public view override returns (bool) { return _isSaleOpen[tierId]; }
  function softCap() public view override returns (uint256) { return _softCap; }
  function publicSaleCloseDate() public view override returns (uint256) { return _saleCloseDates[0]; }
  function whitelistSaleCloseDate(uint256 tierId) public view override returns (uint256) { return _saleCloseDates[tierId]; }
  function lockerUnlockDate() public view override returns (uint256) { return _isSaleClosed ? _saleCloseDate + _lockDuration : 0; }
  function isRefundActivated() public view override returns (bool) { return _isRefundActivated; }
  function purchaseAmount(address _address) public view override returns (uint256) { return _purchaseAmount[_address]; }
  function refundClaimed(address _address) public view override returns (bool) { return _refundClaimed[_address]; }
  function locker(address _address) public view override returns (address) { return address(_lockers[_address]); }
  function tokensSold() public view override returns (uint256) { return _tokensSold; }
  function lockDuration() public view override returns (uint256) { return _lockDuration; }
  function isSaleClosed() public view override returns (bool) { return _isSaleClosed; }
  
  /**
   * External setter functions
   */
  function openPublicSale(bool isOpen) override external onlyTokenOwner {
    _isSaleOpen[0] = isOpen;
  }

  function openWhitelistSale(uint256 tierId, bool isOpen) override external onlyTokenOwner {
    _isSaleOpen[tierId] = isOpen;
  }

  function setSoftCap(uint256 softCapAmount) override external onlyTokenOwner {
    _softCap = softCapAmount;
  }

  function setPublicSaleCloseDate(uint256 date) override external onlyTokenOwner {
    _saleCloseDates[0] = date;
  }

  function setWhitelistSaleCloseDate(uint256 tierId, uint256 date) override external onlyTokenOwner {
    _saleCloseDates[tierId] = date;
  }

  function setLockDuration(uint256 duration) override external onlyTokenOwner {
    _lockDuration = duration;
  }

  function addToWhitelist(address[] memory _addresses, uint256 _tierId) override external onlyTokenOwner {
    for (uint256 i = 0; i < _addresses.length; i++) {
      whitelist[_addresses[i]] = _tierId;
    }
  }

  function removeFromWhitelist(address[] memory _addresses) override external onlyTokenOwner {
    for (uint256 i = 0; i < _addresses.length; i++) {
      whitelist[_addresses[i]] = 0;
    }
  }

  function addCustomTier (
    uint256 tierId,
    uint256 minPurchaseAmount,
    uint256 maxPurchaseAmount,
    uint256 tokensPerEth
  ) external override onlyTokenOwner {
    tiers.push(Tier(tierId, minPurchaseAmount, maxPurchaseAmount, tokensPerEth));
  }
}