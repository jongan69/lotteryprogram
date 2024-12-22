'use client'

import { useWallet } from '@solana/wallet-adapter-react'
import { WalletButton } from '../solana/solana-provider'
import { redirect } from 'next/navigation'

export default function AccountListFeature() {
  const { publicKey } = useWallet()

  if (publicKey) {
    return redirect(`/account/${publicKey.toString()}`)
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
      <div className="hero bg-base-200 w-full py-16">
        <div className="hero-content text-center">
          <div className="max-w-md">
            <h1 className="text-5xl font-bold mb-8">
              🎰 Ready to Get RICH?! 🤑
            </h1>
            <div className="text-2xl mb-6">
              🎵 Hey now, you're a SOLstar 
              <br/>Get your wallet, go plaaaay! 🎵
            </div>
            <p className="py-4 text-xl mb-4 animate-bounce">
              👇 Connect that fancy wallet below 👇
              <br/>
              <span className="text-sm">(or keep staring at this bouncing text, your choice)</span>
            </p>
            <div className="flex flex-col items-center gap-4">
              <div className="hover:animate-spin-once">
                <WalletButton />
              </div>
              <p className="text-sm text-base-content/70">
                No wallet? No problem! 🦊
                <br/>
                <a
                  href="https://solana.com/developers/guides/getstarted/setup-local-development"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline hover:text-3xl transition-all duration-300"
                >
                  Click here to join the cool kids club 😎
                </a>
              </p>
              <div className="mt-4 text-xs opacity-50 hover:opacity-100 transition-opacity">
                * Not financial advice. Unless you get rich, then we totally advised you. 
                <br/>
                ** Results may vary. Like, a lot. 
                <br/>
                *** Your mom was right about saving money.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
