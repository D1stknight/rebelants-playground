// pages/_app.tsx
import "../styles/globals.css";
import "@rainbow-me/rainbowkit/styles.css";

import type { AppProps } from "next/app";
import { WagmiProvider, createConfig, http } from "wagmi";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apeChain } from "../lib/apechain";

const queryClient = new QueryClient();

const wagmiConfig = getDefaultConfig({
  appName: "Rebel Ants Playground",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "MISSING_PROJECT_ID",
  chains: [apeChain],
  transports: {
    [apeChain.id]: http(),
  },
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <Component {...pageProps} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
