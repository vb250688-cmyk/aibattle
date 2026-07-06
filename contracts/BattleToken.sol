// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title BattleToken ($BATTLE)
/// @notice Sepolia-testnet reward token for AI Battle Trader.
///         - Anyone can claim a fixed daily amount (faucet-style, one claim / 24h / wallet).
///         - Owner (deployer) can additionally mint rewards for leaderboard winners etc.
///         This is a TESTNET DEMO token — it has no real-world value.
contract BattleToken is ERC20, Ownable {
    uint256 public constant DAILY_CLAIM_AMOUNT = 100 * 10 ** 18; // 100 BATTLE
    uint256 public constant CLAIM_COOLDOWN = 1 days;

    mapping(address => uint256) public lastClaim;

    event DailyClaimed(address indexed user, uint256 amount);
    event OwnerMinted(address indexed to, uint256 amount, string reason);

    constructor() ERC20("Battle Token", "BATTLE") Ownable(msg.sender) {
        // Seed supply to deployer — used to fund the staking contract's reward pool.
        _mint(msg.sender, 1_000_000 * 10 ** 18);
    }

    /// @notice Claim your free daily BATTLE tokens. Once per wallet per 24h.
    function claimDaily() external {
        require(
            block.timestamp >= lastClaim[msg.sender] + CLAIM_COOLDOWN,
            "Wait 24h between claims"
        );
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, DAILY_CLAIM_AMOUNT);
        emit DailyClaimed(msg.sender, DAILY_CLAIM_AMOUNT);
    }

    /// @notice How many seconds until `user` can claim again (0 = claimable now).
    function timeUntilNextClaim(address user) external view returns (uint256) {
        uint256 next = lastClaim[user] + CLAIM_COOLDOWN;
        if (block.timestamp >= next) return 0;
        return next - block.timestamp;
    }

    /// @notice Owner-only: mint rewards for leaderboard winners / special events.
    function ownerMint(address to, uint256 amount, string calldata reason) external onlyOwner {
        _mint(to, amount);
        emit OwnerMinted(to, amount, reason);
    }
}
