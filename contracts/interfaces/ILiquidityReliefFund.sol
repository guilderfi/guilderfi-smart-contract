// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface ILiquidityReliefFund {

    function execute() external;
    function withdraw(uint256 amount) external;
    function withdrawTokens(address token, uint256 amount) external;
}