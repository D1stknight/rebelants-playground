// contracts/RebelPointsShop.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RebelPointsShop {
    address public owner;
    address public treasury;

    struct Pack {
        uint256 apeCost;     // in wei
        uint256 pointsOut;   // points credited off-chain
        bool active;
    }

    mapping(uint256 => Pack) public packs;

    event PackSet(uint256 indexed packId, uint256 apeCost, uint256 pointsOut, bool active);
    event TreasurySet(address indexed treasury);
    event PointsPurchased(address indexed buyer, uint256 indexed packId, uint256 apePaid, uint256 pointsOut);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _treasury) {
        owner = msg.sender;
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "bad treasury");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    function setPack(uint256 packId, uint256 apeCost, uint256 pointsOut, bool active) external onlyOwner {
        packs[packId] = Pack({ apeCost: apeCost, pointsOut: pointsOut, active: active });
        emit PackSet(packId, apeCost, pointsOut, active);
    }

    function buy(uint256 packId) external payable {
        Pack memory p = packs[packId];
        require(p.active, "pack inactive");
        require(msg.value == p.apeCost, "wrong ape amount");

        (bool ok, ) = treasury.call{ value: msg.value }("");
        require(ok, "treasury transfer failed");

        emit PointsPurchased(msg.sender, packId, msg.value, p.pointsOut);
    }
}
