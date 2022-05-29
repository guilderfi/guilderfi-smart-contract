// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface ISwapEngine {

    function execute() external;
    function recordFees(uint256 lrfAmount, uint256 safeExitAmount, uint256 treasuryAmount) external;
    function isEnabled() external view returns (bool);
    function setEnabled(bool _enable) external;
    function withdraw(uint256 amount) external;
    function withdrawTokens(address token, uint256 amount) external;
}