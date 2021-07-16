import HDWalletProvider from "@truffle/hdwallet-provider";
import { ConstructorArguments } from "@truffle/hdwallet-provider/dist/constructor/ConstructorArguments";
import HookedSubprovider from "@trufflesuite/web3-provider-engine/subproviders/hooked-wallet";
import * as EthUtil from "ethereumjs-util";
import ProviderEngine from "@trufflesuite/web3-provider-engine";
import { getOptions } from "@truffle/hdwallet-provider/dist/constructor/getOptions";
import { Godwoker, GodwokerOption, AbiItems } from "@polyjuice-provider/base"

// export const POLY_MAX_BLOCK_GAS_LIMIT = 12500000;
export const POLY_MAX_TRANSACTION_GAS_LIMIT = 12500000;
export const POLY_MIN_GAS_PRICE = 0;
export const DEFAULT_EMPTY_ETH_ADDRESS = `0x${"0".repeat(40)}`;

type PolyjuiceConfig = {
  rollupTypeHash: string;
  ethAccountLockCodeHash: string;
  abiItems?: AbiItems;
  web3Url?: string;
};

export class PolyjuiceHDWalletProvider extends HDWalletProvider {
  constructor(
    args: ConstructorArguments,
    polyjuiceConfig: PolyjuiceConfig,
  ) {
    super(...args);

    const {
      pollingInterval = 4000,
    } = getOptions(...args);

    const tmpAccounts = this.getAddresses();
    // @ts-ignore: Private method
    const tmpWallets = this.wallets;

    const godwokerOption: GodwokerOption = {
      godwoken: {
        rollup_type_hash: polyjuiceConfig.rollupTypeHash,
        eth_account_lock: {
          code_hash: polyjuiceConfig.ethAccountLockCodeHash,
          hash_type: "type",
        }
      }
    }

    const godwoker = new Godwoker(polyjuiceConfig.web3Url, godwokerOption);

    // reset engine
    this.engine.stop();
    this.engine = new ProviderEngine({
      pollingInterval
    });

    const self = this;
    this.engine.addProvider(
      new HookedSubprovider({
        getAccounts(cb: any) {
          cb(null, tmpAccounts);
        },
        getPrivateKey(address: string, cb: any) {
          if (!tmpWallets[address]) {
            return cb("Account not found");
          } else {
            cb(null, tmpWallets[address].getPrivateKey().toString("hex"));
          }
        },
        async signTransaction(txParams: any, cb: any) {
          // @ts-ignore: Private method
          await self.initialized;
          // we need to rename the 'gas' field
          txParams.gasLimit = txParams.gas;
          delete txParams.gas;

          let pkey;
          const from = txParams.from.toLowerCase();
          if (tmpWallets[from]) {
            pkey = tmpWallets[from].getPrivateKey();
          } else {
            cb("Account not found");
          }
          // @ts-ignore: Private method
          const chain = self.chainId;
          const KNOWN_CHAIN_IDS = new Set([1, 3, 4, 5, 42]);

          // Transaction structure
          // raw: Buffer[];
          // nonce: Buffer;
          // gasLimit: Buffer;
          // gasPrice: Buffer;
          // to: Buffer;
          // value: Buffer;
          // data: Buffer;
          // v: Buffer;
          // r: Buffer;
          // s: Buffer;

          let t = {
            from: EthUtil.bufferToHex(txParams.from),
            to: 
              EthUtil.bufferToHex(txParams.to) ||
              DEFAULT_EMPTY_ETH_ADDRESS,
            value: EthUtil.bufferToHex(txParams.value) || "0x0",
            data: EthUtil.bufferToHex(txParams.data),
            gas: 
              EthUtil.bufferToHex(txParams.gasLimit) ||
              "0x" + POLY_MAX_TRANSACTION_GAS_LIMIT.toString(16),
            gasPrice:
              EthUtil.bufferToHex(txParams.gasPrice) ||
              "0x" + POLY_MIN_GAS_PRICE.toString(16),
          }
          const polyjuice_tx = await godwoker.assembleRawL2Transaction(t);
          const message = await godwoker.generateMessageFromEthTransaction(t);
          const msgHashBuff = Buffer.from(message);
          const sig = EthUtil.ecsign(msgHashBuff, pkey);
          const signature = EthUtil.toRpcSig(sig.v, sig.r, sig.s);
          const l2_tx = {
            raw: polyjuice_tx,
            signature,
          };
          const rawTx = godwoker.serializeL2Transaction(l2_tx);

          // let txOptions;
          // if (typeof chain !== "undefined" && KNOWN_CHAIN_IDS.has(chain)) {
          //   txOptions = { chain };
          // } else if (typeof chain !== "undefined") {
          //   const common = Common.forCustomChain(
          //     1,
          //     {
          //       name: "custom chain",
          //       chainId: chain
          //     },
          //     // @ts-ignore: Private method
          //     self.hardfork
          //   );
          //   txOptions = { common };
          // }
          // const tx = new Transaction(txParams, txOptions);
          // tx.sign(pkey as Buffer);
          // const rawTx = `0x${tx.serialize().toString("hex")}`;
          cb(null, rawTx);
        },
        signMessage({ data, from }: any, cb: any) {
          const dataIfExists = data;
          if (!dataIfExists) {
            cb("No data to sign");
          }
          if (!tmpWallets[from]) {
            cb("Account not found");
          }
          let pkey = tmpWallets[from].getPrivateKey();
          const dataBuff = EthUtil.toBuffer(dataIfExists);
          const msgHashBuff = EthUtil.hashPersonalMessage(dataBuff);
          const sig = EthUtil.ecsign(msgHashBuff, pkey);
          const rpcSig = EthUtil.toRpcSig(sig.v, sig.r, sig.s);
          cb(null, rpcSig);
        },
        signPersonalMessage(...args: any[]) {
          this.signMessage(...args);
        }
      })
    );
  }

  private signMessage(message: any, pkey: any): string {
    // const dataIfExists = data;
    const messageBuff = EthUtil.toBuffer(message);
    // const msgHashBuff = EthUtil.hashPersonalMessage(dataBuff);
    const sig = EthUtil.ecsign(messageBuff, pkey);
    const rpcSig = EthUtil.toRpcSig(sig.v, sig.r, sig.s);
    return rpcSig
  }
}
