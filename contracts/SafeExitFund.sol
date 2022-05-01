// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// TODO import openzeppelin IERC1155

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";

contract SafeExitFund is ISafeExitFund {

    using SafeMath for uint256;

    struct Package {
        string packageId;
        uint256 insuranceAmount;
        uint256 randomRangeFrom;
        uint256 randomRangeTo;
    }

    Package[] private packages;

    uint256 private randomSeed = 123456789;
    bool private randomSeedHasBeenSet = false;

    // GuilderFi token contract address
    IGuilderFi internal _token;

    modifier onlyToken() {
        require(msg.sender == address(_token), "Sender is not token contract"); _;
    }

    modifier onlyTokenOwner() {
        require(msg.sender == address(_token.getOwner()), "Sender is not token owner"); _;
    }

    constructor () {
        _token = IGuilderFi(msg.sender);

        packages.push(Package("Package A", 25 ether, 0, 24));
        packages.push(Package("Package B", 5 ether, 25, 49));
        packages.push(Package("Package C", 1 ether, 50, 74));
        packages.push(Package("Package D", 10 ether, 75, 99));
    }

    // External function executed with every main contract transaction
    function execute() override external onlyToken {
        // TODO
    }


    function getInsuranceAmount(address _walletAddress) external view returns (uint256) {

        // using address + randomSeed, generate random integer between 0 and 99
        uint256 randomNum = uint256(keccak256(abi.encodePacked(_walletAddress, randomSeed))) % 100;

        for (uint i=0; i<packages.length; i++) {
            if (randomNum >= packages[i].randomRangeFrom && randomNum <= packages[i].randomRangeTo) {
                return packages[i].insuranceAmount;
            }
        }

        return 0;
    }

    // Should be set after pre-sales are complete
    // Trigerred by an external function from main contract
    function setRandomSeed(uint256 _randomSeed) external onlyToken {
        if (!randomSeedHasBeenSet) {
            randomSeed = _randomSeed;

            // ensure random seed can only be set once
            randomSeedHasBeenSet = true;
        }
    }

    function withdraw(uint256 amount) external override onlyTokenOwner {
        payable(msg.sender).transfer(amount);
    }
    
    function withdrawTokens(address token, uint256 amount) external override onlyTokenOwner {
        IERC20(token).transfer(msg.sender, amount);
    }

    receive() external payable {}
}