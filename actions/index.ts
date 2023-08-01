import {
	ActionFn,
	Context,
	Event,
	Log,
	TransactionEvent
} from '@tenderly/actions';
import { BigNumber, Contract, Wallet, constants, ethers } from 'ethers';
import { hexConcat, hexZeroPad, keccak256, parseUnits, zeroPad } from 'ethers/lib/utils';
import OracleAbi from "./abi/OracleContract.json";
import ExchangeAbi from "./abi/ExchangeContract.json";
import Erc20Abi from "./abi/Erc20Contract.json";
import settings from "./settings.json";

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

	const skipSlot = settings.skipSlots.find((x) => x.token == tokenAddress)

	for (let i = 0; i < 202; i++) {
		if (skipSlot?.slot == i) {
			continue;
		}

		const slotSol = getSlotFromAddressMappingSolidity(user, i);
		const slotVyper = getSlotFromAddressMappingVyper(user, i);

		const rawSlotValue = hexZeroPad(amountToSet.toHexString(), 32);

		stateDiff[slotSol] = rawSlotValue;
		stateDiff[slotVyper] = rawSlotValue;
	}
	overrides[tokenAddress] = { stateDiff: stateDiff };
	return overrides;
}

function findLog(txEvent: TransactionEvent): Log[] {
	let result: Log[] = [];
	for (let i = 0; i < txEvent.logs.length; i++) {
		const log = txEvent.logs[i];
		if (log.topics[0] == "0xc52abe6244cd3d65bf38f77fae620a60fae313ce8f9c479d5c053f0e32bd8f04") {
			result.push(log);
		}
	}
	return result;
}

export const getPriceFromExchange = async (provider: ethers.providers.JsonRpcProvider, from: string, to: string) => {
	const exchangeAddress = "0xeE0674C1E7d0f64057B6eCFe845DC2519443567F";

	const exchange = new Contract(exchangeAddress, ExchangeAbi, provider);
	const tokenFrom = new Contract(from, Erc20Abi, provider);
	const tokenTo = new Contract(to, Erc20Abi, provider);

	const decimalsOverride = settings.decimalsOverride.find((x) => x.token == from);
	let amount = parseUnits("1.0", await tokenFrom.decimals());

	if (decimalsOverride != undefined) {
		amount = parseUnits("1.0", decimalsOverride.decimals);
	}

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

	const result = await provider.send("tenderly_simulateBundle", [
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

	if (!result[1].status) {
		return { tokensReceived: BigNumber.from("0") }
	}

	const tokensReceived = BigNumber.from(result[1].trace[0].output);
	return { tokensReceived, decimals: decimalsOverride != undefined ? decimalsOverride.decimals : await tokenTo.decimals() as number };
}

export const main: ActionFn = async (context: Context, event: Event) => {
	const txEvent = event as TransactionEvent;

	const polygonUrl = await context.secrets.get("w3_oracle.polygonUrl");
	const privateKey = await context.secrets.get("w3_oracle.privateKey");
	const tenderlyPolygonUrl = await context.secrets.get("w3_oracle.tenderlyPolygonUrl");

	const tenderlyMainnetProvider = new ethers.providers.JsonRpcProvider(tenderlyPolygonUrl);
	const polygonProvider = new ethers.providers.JsonRpcProvider(polygonUrl);

	const log = findLog(txEvent) as Log[];
	const oracleInterface = new ethers.utils.Interface(OracleAbi);

	const account = new Wallet(privateKey, polygonProvider);
	let nonce = await account.getTransactionCount();
	let submitedPrices: Map = {};
	for (let index = 0; index < log.length; index++) {
		const {
			fromToken,
			toToken,
		} = oracleInterface.decodeEventLog(
			"PriceRequested",
			log[index].data,
			log[index].topics
		);

		if (submitedPrices[fromToken + toToken]) {
			continue;
		}

		const price = await getPriceFromExchange(tenderlyMainnetProvider, fromToken, toToken);

		const oracle = new ethers.Contract(log[index].address, oracleInterface, polygonProvider);
		const gasPrice = (await polygonProvider.getGasPrice()).mul(15).div(10);
		const tx = await oracle.connect(account).submitPrice(fromToken, toToken, price.tokensReceived, price.decimals, { gasLimit: 1500000, gasPrice: gasPrice, nonce: nonce });
		console.log(tx.hash, "nonce", nonce);

		submitedPrices[fromToken + toToken] = true;

		nonce++;
	}
}