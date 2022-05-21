// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

interface IPreSale {
  // arrays
  function purchaseAmount(address _address) external returns (uint256);
  function refundClaimed(address _address) external returns (bool);
  function locker(address _address) external returns (address);
  
  // public getter functions
  function token() external view returns (address);
  function isPublicSaleOpen() external view returns (bool);
  function isWhitelistSaleOpen(uint256 tierId) external view returns (bool);
  function publicSaleCloseDate() external view  returns (uint256);
  function whitelistSaleCloseDate(uint256 tierId) external view  returns (uint256);
  function softCap() external view  returns (uint256);
  function lockerUnlockDate() external view  returns (uint256);
  function isRefundActivated() external returns (bool);
  function tokensSold() external returns (uint256);
  function lockDuration() external returns (uint256);
  function isSaleClosed() external returns (bool);

  function getTier(address _address) external view returns (
    uint256 tierId,
    uint256 minAmount,
    uint256 maxAmount,
    uint256 tokensPerEth
  );

  // external setter functions
  function openPublicSale(bool isOpen) external;
  function openWhitelistSale(uint256 tierId, bool isOpen) external;
  function setPublicSaleCloseDate(uint256 date) external;
  function setWhitelistSaleCloseDate(uint256 tierId, uint256 date) external;
  function setSoftCap(uint256 softCapAmount) external;
  function addToWhitelist(address[] memory _addresses, uint256 _tierId) external;
  function removeFromWhitelist(address[] memory _addresses) external;
  function setLockDuration(uint256 _duration) external;

  // functions
  function buyTokens() external payable;
  function finalizeSale() external;
  function claimRefund() external returns (bool);
  function unlockTokens() external;
  function cancelSale() external;

  function addCustomTier(
    uint256 tierId,
    uint256 minPurchaseAmount,
    uint256 maxPurchaseAmount,
    uint256 tokensPerEth
  ) external;
}
