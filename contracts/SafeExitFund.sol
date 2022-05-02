// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/counters.sol";


import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";

contract SafeExitFund is ISafeExitFund, ERC721Enumerable {

    using SafeMath for uint256;

    using Counters for Counters.Counter;
    Counters.Counter private _tokenId;

    struct Package {
        string packageId;
        uint256 insuranceAmount;
        uint256 randomRangeFrom;
        uint256 randomRangeTo;
    }

    Package[] private packages;

    struct NftData {
        uint256 insuredAmount;
        bool used; // one time use
    }

    uint256 public maxSupply = 5000;

    mapping(uint256 => NftData) private nftData;

    uint256 private randomSeed = 123456789;
    uint256 private timestampSalt = 123456789;
    bool private randomSeedHasBeenSet = false;

    // GuilderFi token contract address
    IGuilderFi internal _token;

    modifier onlyToken() {
        require(msg.sender == address(_token), "Sender is not token contract"); _;
    }

    modifier onlyTokenOwner() {
        require(msg.sender == address(_token.getOwner()), "Sender is not token owner"); _;
    }

    modifier onlyPresale() {
        // require(msg.sender == address(_presale), "Sender is not token owner"); // TODO
         _;
    }

    constructor () ERC721("Safe Exit Fund", "SEF") {
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

    function mint(address _walletAddress) external onlyPresale {
        uint256 tokenId = _tokenId.current();
        require(tokenId < maxSupply, "Can't mint more NFTs");
        _mint(_walletAddress, tokenId);
        _tokenId.increment();
    }

    // Gets the insurance amount of an NFT, and the total insurable
    function getNftInsurance(uint256 _nftId) public view returns (uint256, uint256) {
        uint256 tokenId = _tokenId.current();
        require(_nftId <= tokenId, "NFT ID out of bounds");

        if (nftData[_nftId].used == true) return (0,0);

        // using timestamp salt & random seed & nftId we get a pseudo random number between 0 and 99
        uint256 randomNum = uint256(keccak256(abi.encodePacked(timestampSalt, randomSeed, _nftId))) % 100;

        for (uint i=0; i<packages.length; i++) {
            if (randomNum >= packages[i].randomRangeFrom && randomNum <= packages[i].randomRangeTo) {
                return (nftData[_nftId].insuredAmount, packages[i].insuranceAmount);
            }
        }

        return (0,0);
    }

    function getTotalUserInsurance(address _walletAddress) external view returns (uint256, uint256) {
        uint256 insuredAmount = 0;
        uint256 totalInsurable = 0;

        for (uint256 i = 0; i < balanceOf(_walletAddress); i++) {
            uint256 nftId = tokenOfOwnerByIndex(_walletAddress, i);
            (uint256 insuredPerNft, uint256 totalInsurablePerNft) = getNftInsurance(nftId);
            insuredAmount += insuredPerNft;
            totalInsurable += totalInsurablePerNft;
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

    function withdraw(uint256 amount) external override onlyTokenOwner {
        payable(msg.sender).transfer(amount);
    }
    
    function withdrawTokens(address token, uint256 amount) external override onlyTokenOwner {
        IERC20(token).transfer(msg.sender, amount);
    }

    receive() external payable {}
}