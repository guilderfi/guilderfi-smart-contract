// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface IGuilderFi {
      
    // Events
    event LogRebase(
        uint256 indexed epoch,
        uint256 totalSupply,
        uint256 pendingRebases
    );

    // Fee struct
    struct Fee {
        uint256 treasuryFee;
        uint256 lrfFee;
        uint256 liquidityFee;
        uint256 safeExitFee;
        uint256 burnFee;
        uint256 totalFee;
    }

    // Rebase functions
    function rebase() external;
    function getRebaseRate() external view returns (uint256);
    function maxRebaseBatchSize() external view returns (uint256);
    
    // Transfer
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);

    // Allowance
    function allowance(address owner_, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);

    // Launch token
    function launchToken() external;
    
    // Set on/off flags
    function setAutoSwap(bool _flag) external;
    function setAutoLiquidity(bool _flag) external;
    function setAutoLrf(bool _flag) external;
    function setAutoSafeExit(bool _flag) external;
    function setAutoRebase(bool _flag) external;

    // Set frequencies
    function setAutoLiquidityFrequency(uint256 _frequency) external;
    function setLrfFrequency(uint256 _frequency) external;
    function setSwapFrequency(uint256 _frequency) external;
    
    // Other settings
    function setMaxRebaseBatchSize(uint256 _maxRebaseBatchSize) external;

    // Address settings
    function setFeeExempt(address _address, bool _flag) external;
    function setBlacklist(address _address, bool _flag) external;

    // Read only functions
    // function isPreSale() external view returns (bool);
    function hasLaunched() external view returns (bool);

    // Addresses
    function getOwner() external view returns (address);
    function getTreasuryAddress() external view returns (address);
    function getSwapEngineAddress() external view returns (address);
    function getLrfAddress() external view returns (address);
    function getAutoLiquidityAddress() external view returns (address);
    function getSafeExitFundAddress() external view returns (address);
    function getPreSaleAddress() external view returns (address);

    // Setup functions
    function setSwapEngine(address _address) external;
    function setLrf(address _address) external;
    function setLiquidityEngine(address _address) external;
    function setSafeExitFund(address _address) external;
    function setPreSaleEngine(address _address) external;
    function setTreasury(address _address) external;
    function setDex(address routerAddress) external;

    // Setup fees
    function setFees(
        bool _isSellFee,
        uint256 _treasuryFee,
        uint256 _lrfFee,
        uint256 _liquidityFee,
        uint256 _safeExitFee,
        uint256 _burnFee
    ) external;

    // Getters - setting flags
    function isAutoSwapEnabled() external view returns (bool);
    function isAutoRebaseEnabled() external view returns (bool);
    function isAutoLiquidityEnabled() external view returns (bool);
    function isAutoLrfEnabled() external view returns (bool);
    function isAutoSafeExitEnabled() external view returns (bool);

    // Getters - frequencies
    function autoSwapFrequency() external view returns (uint256);
    function autoLiquidityFrequency() external view returns (uint256);
    function autoLrfFrequency() external view returns (uint256);

    // Date/time stamps
    function initRebaseStartTime() external view returns (uint256);
    function lastRebaseTime() external view returns (uint256);
    function lastAddLiquidityTime() external view returns (uint256);
    function lastLrfExecutionTime() external view returns (uint256);
    function lastSwapTime() external view returns (uint256);
    function lastEpoch() external view returns (uint256);

    // Dex addresses
    function getRouter() external view returns (address);
    function getPair() external view returns (address);

    // Standard ERC20 functions
    function totalSupply() external view returns (uint256);
    function balanceOf(address who) external view returns (uint256);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external pure returns (uint8);
    
    function manualSync() external;
}