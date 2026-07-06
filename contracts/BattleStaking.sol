// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BattleStaking
 * @notice Stake $BATTLE tokens to earn rewards. Always safe to unstake principal.
 * 
 * KEY DESIGN PRINCIPLE:
 * - unstake() ALWAYS succeeds and returns your staked amount
 * - Rewards are claimed separately via claimReward()
 * - If reward pool is insufficient, claimReward() reverts with clear message
 * - Owner can fund the reward pool via fundRewards()
 * - Principal withdrawal is 100% safe from reward pool issues
 */
contract BattleStaking is Ownable, ReentrancyGuard {
    IERC20 public immutable battleToken;

    // APR in basis points: 1000 = 10% APR
    uint256 public aprBasisPoints = 1000;
    
    // Constants for APR calculation
    uint256 private constant YEAR = 365 days;
    uint256 private constant BPS_DENOM = 10_000;

    /**
     * @notice User staking information
     * @param amount Total BATTLE tokens staked
     * @param rewardCheckpoint Timestamp when rewards were last settled
     */
    struct StakeInfo {
        uint256 amount;
        uint256 rewardCheckpoint;
    }
    
    // Mapping: wallet => StakeInfo
    mapping(address => StakeInfo) public stakes;

    // Events
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event AprUpdated(uint256 newBps);
    event RewardPoolFunded(address indexed owner, uint256 amount);

    /**
     * @notice Constructor - set the token address
     * @param _battleToken Address of the BATTLE ERC-20 token
     */
    constructor(address _battleToken) Ownable(msg.sender) {
        require(_battleToken != address(0), "Invalid token address");
        battleToken = IERC20(_battleToken);
    }

    /**
     * @notice Calculate pending reward for a user (READ-ONLY)
     * @param user Wallet address
     * @return Accrued reward in wei
     * 
     * Formula: (stakedAmount * APR% * elapsedSeconds) / (100% * secondsPerYear)
     * Example: 1000 BATTLE at 10% APR for 1 year = 100 BATTLE reward
     */
    function pendingReward(address user) public view returns (uint256) {
        StakeInfo memory s = stakes[user];
        if (s.amount == 0) return 0;
        
        uint256 elapsed = block.timestamp - s.rewardCheckpoint;
        // (amount * aprBasisPoints * elapsed) / (BPS_DENOM * YEAR)
        return (s.amount * aprBasisPoints * elapsed) / (BPS_DENOM * YEAR);
    }

    /**
     * @notice View available BATTLE balance in the reward pool
     * @return BATTLE token balance currently held in this contract
     * 
     * This is the balance available for claimReward() transfers.
     * When this is insufficient, owner must call fundRewards() to top it up.
     */
    function rewardPoolBalance() external view returns (uint256) {
        return battleToken.balanceOf(address(this));
    }

    /**
     * @notice Stake BATTLE tokens to start earning APR rewards
     * @param amount Amount of BATTLE to stake (must be > 0)
     * 
     * Your staked tokens will accrue rewards at the current APR.
     * You can claim rewards anytime with claimReward().
     * You can unstake anytime — your principal is always safe.
     * 
     * Requirements:
     * - amount > 0
     * - You must have approved this contract to spend tokens (approve this address for 'amount')
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        // Transfer tokens from user to contract
        require(
            battleToken.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed — check approval"
        );

        // Update user's staked balance and reward checkpoint
        stakes[msg.sender].amount += amount;
        stakes[msg.sender].rewardCheckpoint = block.timestamp;

        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Unstake your principal (GUARANTEED SAFE ✅)
     * @param amount Amount of staked BATTLE to withdraw
     * 
     * 🟢 CRITICAL SAFETY GUARANTEE:
     * This function ALWAYS returns your principal, regardless of reward pool status.
     * Even if fundRewards() has never been called, you can unstake 100%.
     * 
     * ⚠️ IMPORTANT: If you have pending rewards, claim them before unstaking!
     * Once you unstake, your reward accrual resets. Call claimReward() first if needed.
     * 
     * Requirements:
     * - amount <= your staked balance
     */
    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= amount, "Insufficient staked balance");

        // Deduct from staked amount
        s.amount -= amount;

        // 🟢 CRITICAL: Always return the principal, no matter what
        // This transfer CANNOT fail due to reward pool issues
        require(
            battleToken.transfer(msg.sender, amount),
            "Principal transfer failed"
        );

        // Update checkpoint for future reward calculations
        s.rewardCheckpoint = block.timestamp;

        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Claim your accrued rewards (separate from principal)
     * 
     * Your pending reward is calculated from the time you last staked or claimed.
     * This function transfers the reward to you.
     * 
     * 🔴 IMPORTANT: This function CAN revert if the reward pool is empty.
     * If you see "Insufficient reward pool - owner must call fundRewards()",
     * it means the owner needs to deposit more BATTLE tokens into this contract.
     * Your principal is SAFE — it's never affected by this error.
     * You can unstake anytime. The reward just waits until the pool is funded.
     * 
     * Requirements:
     * - You have pending rewards > 0
     * - Contract's BATTLE balance >= your pending reward
     */
    function claimReward() external nonReentrant {
        uint256 reward = pendingReward(msg.sender);
        require(reward > 0, "No pending reward");

        // Check if contract has enough tokens to pay this reward
        uint256 poolBalance = battleToken.balanceOf(address(this));
        require(
            poolBalance >= reward,
            "Insufficient reward pool — owner must call fundRewards() to deposit more BATTLE"
        );

        // Reset checkpoint to current time (rewards start fresh from now)
        stakes[msg.sender].rewardCheckpoint = block.timestamp;

        // Transfer reward to user
        require(
            battleToken.transfer(msg.sender, reward),
            "Reward transfer failed"
        );

        emit RewardClaimed(msg.sender, reward);
    }

    /**
     * @notice Owner deposits BATTLE tokens to fund the reward pool
     * @param amount BATTLE tokens to deposit
     * 
     * Called when users get "Insufficient reward pool" error from claimReward().
     * This tops up the contract's BATTLE balance so rewards can be claimed.
     * 
     * Owner must approve this contract to spend 'amount' tokens before calling.
     * 
     * Requirements:
     * - Only owner can call
     * - amount > 0
     * - Owner must have approved this contract to spend 'amount' tokens
     */
    function fundRewards(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");

        require(
            battleToken.transferFrom(msg.sender, address(this), amount),
            "Token transfer failed — check owner approval"
        );

        emit RewardPoolFunded(msg.sender, amount);
    }

    /**
     * @notice Owner adjusts the APR percentage for all future rewards
     * @param newBps New APR in basis points (1000 = 10%, 500 = 5%, etc.)
     * 
     * Changes apply to rewards earned going forward.
     * Does not affect already-accrued pending rewards.
     * 
     * Requirements:
     * - Only owner can call
     * - newBps <= 5000 (50% — sanity cap to prevent runaway rewards)
     */
    function setAPR(uint256 newBps) external onlyOwner {
        require(newBps <= 5000, "APR cannot exceed 50%");
        aprBasisPoints = newBps;
        emit AprUpdated(newBps);
    }

    /**
     * @notice View the current staked amount for a user
     * @param user Wallet address
     * @return Amount of BATTLE currently staked
     */
    function stakedAmount(address user) external view returns (uint256) {
        return stakes[user].amount;
    }

    /**
     * @notice View the last reward checkpoint for a user
     * @param user Wallet address
     * @return Timestamp of last reward claim/stake
     * 
     * Rewards accrue from this timestamp until now.
     * pendingReward() uses this to calculate elapsed time.
     */
    function rewardCheckpoint(address user) external view returns (uint256) {
        return stakes[user].rewardCheckpoint;
    }
}
