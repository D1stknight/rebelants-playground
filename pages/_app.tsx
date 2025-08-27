// pages/_app.tsx
import type { AppProps } from 'next/app';
import '../styles/globals.css';
import PrizeModalProvider from '../components/PrizeModalHost';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <PrizeModalProvider>
      <Component {...pageProps} />
    </PrizeModalProvider>
  );
}
