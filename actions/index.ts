import {
	ActionFn,
	Context,
	Event,
	Log,
	TransactionEvent
} from '@tenderly/actions';
import { BigNumber, Contract, Wallet, constants, ethers } from 'ethers';
import { hexConcat, hexZeroPad, keccak256, zeroPad } from 'ethers/lib/utils';
import OracleAbi from "./abi/OracleContract.json";
import ExchangeAbi from "./abi/ExchangeContract.json";
import Erc20Abi from "./abi/Erc20Contract.json";

interface Map {
    [index: string]: any
}

async function getStorageOverrides(tokenAddress: string, user: string, amountToSet: BigNumber): Promise<Map> {
    let overrides: Map = {};
    let stateDiff: Map = {};

    const getSlotFromAddressMappingSolidity = (address: string, i: number) => {
        const value = hexConcat(
            [zeroPad(address, 32), zeroPad(BigNumber.from(i.toString()).toHexString(), 32)]
        );
        return keccak256(value);
    }

    const getSlotFromAddressMappingVyper = (address: string, i: number) => {
        const value = hexConcat(
            [zeroPad(BigNumber.from(i.toString()).toHexString(), 32), zeroPad(address, 32)]
        );
        return keccak256(value);
    }

    for (let i = 0; i < 202; i++) {
        const slotSol = getSlotFromAddressMappingSolidity(user, i);
        const slotVyper = getSlotFromAddressMappingVyper(user, i);

        const rawSlotValue = hexZeroPad(amountToSet.toHexString(), 32);

        stateDiff[slotSol] = rawSlotValue;
        stateDiff[slotVyper] = rawSlotValue;
    }
    overrides[tokenAddress] = {stateDiff: stateDiff};
    return overrides;
}

function findLog(txEvent: TransactionEvent): Log | undefined {
	for (let i = 0; i < txEvent.logs.length; i++) {
		const log = txEvent.logs[i];
		if (log.topics[0] == "0xe4c23cb0ccec08a3c355beae294ba7c1dfcc70eaac71453411e88ac890eb3296") {
			return log;
		}
	}
	return undefined;
}

export const main: ActionFn = async (context: Context, event: Event) => {
	const txEvent = event as TransactionEvent;

	// const mainnetUrl = await context.secrets.get("w3_oracle.mainnetUrl");
	const sepoliatUrl = await context.secrets.get("w3_oracle.sepoliaUrl");
	const mnemonic = await context.secrets.get("w3_oracle.mnemonic");
	const tenderlyMainnetUrl = await context.secrets.get("w3_oracle.tenderlyMainnetUrl");
	
	const tenderlyMainnetProvider = new ethers.providers.JsonRpcProvider(tenderlyMainnetUrl);
	// const mainnetProvider = new ethers.providers.JsonRpcProvider(mainnetUrl);
	const sepoliaProvider = new ethers.providers.JsonRpcProvider(sepoliatUrl);

	const log = findLog(txEvent) as Log;
	const oracleInterface = new ethers.utils.Interface(OracleAbi.abi);

	const getPriceFromExchange = async (from: string, to: string, amount: BigNumber) => {
		const exchangeAddress = "0x29c66CF57a03d41Cfe6d9ecB6883aa0E2AbA21Ec";

		const exchange = new Contract(exchangeAddress, ExchangeAbi, tenderlyMainnetProvider);
		const tokenFrom = new Contract(from, Erc20Abi, tenderlyMainnetProvider);
		const tokenTo = new Contract(to, Erc20Abi, tenderlyMainnetProvider);
	
		const whale = Wallet.createRandom();

		const overrides = await getStorageOverrides(tokenFrom.address, whale.address, amount);

		const approveData = tokenFrom.interface.encodeFunctionData(
			"approve",
			[exchange.address, constants.MaxUint256]
		);
		const exchangeData = exchange.interface.encodeFunctionData(
			"exchange",
			[tokenFrom.address, tokenTo.address, amount, 0]
		);

		const result = await tenderlyMainnetProvider.send("tenderly_simulateBundle", [
			[
				{
					"from": whale.address,
					"to": tokenFrom.address,
					"data": approveData,
				},
				{
					"from": whale.address,
					"to": exchange.address,
					"data": exchangeData,
				}
			],
			"latest",
			overrides
		]);
	
		const tokensReceived = BigNumber.from(result[1].trace[0].output);
		const tokenDecimals: number = await tokenTo.decimals();
		return {tokensReceived, tokenDecimals};
	}

	const account = Wallet.fromMnemonic(mnemonic).connect(sepoliaProvider);
	const {
		key,
		// chainId,
		fromToken,
		toToken,
		amount
	} = oracleInterface.decodeEventLog(
        "PriceRequested",
        log.data,
        log.topics
    );
	
	const price = await getPriceFromExchange(fromToken, toToken, amount);
	const oracle = new ethers.Contract(log.address, oracleInterface, sepoliaProvider);

	await oracle.connect(account).submitPrice(key, price.tokensReceived, price.tokenDecimals)
}
