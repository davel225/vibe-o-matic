// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

/**
 * Permissive access predicate for the vibe-o-matic ERC-8257 listing.
 *
 * Why permissive: the actual access gating happens at the HTTP layer via
 * x402 (verify USDC payment → render → settle in that order; non-paid
 * callers get a 402, render never runs for them). The ERC-8257 predicate's
 * job here is just to declare to the registry "no on-chain pre-flight
 * required; ask the HTTP endpoint directly."
 *
 * The spec explicitly contemplates this pattern in § 9: "the predicate
 * gates onchain eligibility; the HTTP endpoint enforces payment and may
 * optionally require proof." For x402 endpoints, the HTTP-layer payment
 * verification IS the access control, and the registry just needs a
 * compliant predicate to point at.
 *
 * Deploy this contract on Base mainnet via Remix
 * (https://remix.ethereum.org/) and copy the deployed address into the
 * registration script. The deployer wallet does NOT need to be the same
 * as the treasury wallet — only the registerTool() caller does.
 *
 * To later harden access control (e.g. require a NFT or a subscription),
 * deploy a new predicate and call setAccessPredicate(toolId, newAddr)
 * from the treasury wallet. The interface stays the same.
 */

/// @dev kind selectors per ERC-8257 §5, normative marker interfaces
struct AccessRequirement {
    bytes4 kind;
    bytes data;
    string label;
}

enum RequirementLogic { AND, OR }

interface IAccessPredicate {
    function hasAccess(
        uint256 toolId,
        address account,
        bytes calldata data
    ) external view returns (bool);

    function name() external view returns (string memory);

    function getRequirements(uint256 toolId)
        external
        view
        returns (
            AccessRequirement[] memory requirements,
            RequirementLogic logic
        );
}

contract VibeifyAccessPredicate is IAccessPredicate {
    string private constant _NAME = "vibeify-x402-open";

    /// @notice Always returns true. Access is enforced at the HTTP layer
    ///         via x402 payment verification (see /api/vibeify/x402).
    function hasAccess(
        uint256, /* toolId */
        address, /* account */
        bytes calldata /* data */
    ) external pure override returns (bool) {
        return true;
    }

    function name() external pure override returns (string memory) {
        return _NAME;
    }

    /// @notice No on-chain access requirements; the x402 payment is the
    ///         only gate, declared off-chain in the manifest's `pricing`.
    function getRequirements(uint256 /* toolId */)
        external
        pure
        override
        returns (
            AccessRequirement[] memory requirements,
            RequirementLogic logic
        )
    {
        requirements = new AccessRequirement[](0);
        logic = RequirementLogic.AND;
    }

    /// @notice ERC-165 support. The registry MAY check that the predicate
    ///         answers truthfully for IAccessPredicate's interface ID
    ///         (0xbdf9dc18 per the ERC-8257 spec). Implementations that
    ///         claim ERC-165 support MUST return true for their declared
    ///         interfaces.
    function supportsInterface(bytes4 interfaceId)
        external
        pure
        returns (bool)
    {
        // IAccessPredicate (per ERC-8257 §10)
        if (interfaceId == 0xbdf9dc18) return true;
        // ERC-165 itself
        if (interfaceId == 0x01ffc9a7) return true;
        return false;
    }
}
