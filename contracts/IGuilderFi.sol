// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

interface IGuilderFi {
  
  // Events
  event LogRebase(uint256 indexed epoch, uint256 totalSupply);

  // Fee struct
  struct Fee {
    uint256 treasuryFee;
    uint256 lrfFee;
    uint256 liquidityFee;
    uint256 burnFee;
    uint256 totalFee;
  }

  // Rebase functions
  function rebase() external;
  function getRebaseRate() external view returns (uint256);

  // Transfer
  function transfer(address to, uint256 value) external returns (bool);
  function transferFrom(address from, address to, uint256 value) external returns (bool);

  // Allowance
  function allowance(address owner_, address spender) external view returns (uint256);
  function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);
  function increaseAllowance(address spender, uint256 addedValue) external returns (bool);
  function approve(address spender, uint256 value) external returns (bool);

  // Smart Contract Settings
  function openTrade() external;
  function setAutoSwap(bool _flag) external;
  function setAutoAddLiquidity(bool _flag) external;
  function setAutoRebase(bool _flag) external;
  function setMaxRebaseBatchSize(uint256 _maxRebaseBatchSize) external;
  function setDex(address routerAddress) external;
  function setAddresses(
    address _autoLiquidityAddress,
    address _treasuryAddress,
    address _lrfAddress,
    address _burnAddress
  ) external;
  function setFees(
    bool _isSellFee,
    uint256 _treasuryFee,
    uint256 _lrfFee,
    uint256 _liquidityFee,
    uint256 _burnFee
  ) external;

  // Address settings
  function setFeeExempt(address _address, bool _flag) external;
  function setBlacklist(address _address, bool _flag) external;
  function allowPreSaleTransfer(address _addr, bool _flag) external;

  // Read only functions
  function getCirculatingSupply() external view returns (uint256);
  function checkFeeExempt(address _addr) external view returns (bool);
  function isNotInSwap() external view returns (bool);

  // Standard ERC20 functions
  function totalSupply() external view returns (uint256);
  function balanceOf(address who) external view returns (uint256);
  function name() external view returns (string memory);
  function symbol() external view returns (string memory);
  function decimals() external pure returns (uint8);
  
  function manualSync() external;
}