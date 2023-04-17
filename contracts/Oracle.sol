// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Address.sol";

interface IOracleCallbackReceiver {
    function oracleCallback(bytes memory data) external;
}

contract Oracle is AccessControl {
    using Address for address;

    struct PriceRequest {
        uint256 value;
        address callbackTo;
        uint8 decimals;
        bool callbackExecuteSuccess;
        bytes callbackData;
    }

    bytes32 public constant PRICE_REQUESTER_ROLE =
        keccak256("PRICE_REQUESTER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    mapping(bytes32 => PriceRequest) public priceRequests;

    event PriceRequested(
        bytes32 key,
        uint256 chainId,
        address fromToken,
        address toToken,
        uint256 amount
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PRICE_REQUESTER_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
    }

    function requestPrice(
        bytes32 key,
        uint256 chainId,
        address fromToken,
        address toToken,
        uint256 amount,
        address callbackAddress,
        bytes memory callbackData
    ) external onlyRole(PRICE_REQUESTER_ROLE) {
        PriceRequest storage request = priceRequests[key];

        request.callbackTo = callbackAddress;
        request.callbackData = callbackData;

        emit PriceRequested(key, chainId, fromToken, toToken, amount);
    }

    function submitPrice(
        bytes32 key,
        uint256 value,
        uint8 decimals
    ) external onlyRole(ORACLE_ROLE) {
        PriceRequest storage request = priceRequests[key];

        request.value = value;
        request.decimals = decimals;
        IOracleCallbackReceiver callbackTo = IOracleCallbackReceiver(
            request.callbackTo
        );

        if (address(callbackTo) != address(0)) {
            try callbackTo.oracleCallback(request.callbackData) {
                request.callbackExecuteSuccess = true;
            } catch {}
        }
    }
}
