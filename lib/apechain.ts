// lib/apechain.ts
import type { Chain } from "viem";

export const apeChain: Chain = {
  id: 33139,
  name: "ApeChain",
  nativeCurrency: {
    name: "ApeCoin",
    symbol: "APE",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ["https://apechain.calderachain.xyz/http"] },
    public: { http: ["https://apechain.calderachain.xyz/http"] },
  },
  blockExplorers: {
    default: {
      name: "ApeChain Explorer",
      url: "https://apechain.calderaexplorer.xyz",
    },
  },
};
