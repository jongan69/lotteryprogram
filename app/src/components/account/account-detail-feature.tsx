'use client'

import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { PublicKey } from '@solana/web3.js'
import { AccountDetail } from './account-ui'

export default function AccountDetailFeature() {
  const params = useParams()
  const address = useMemo(() => {
    if (!params?.address || typeof params.address !== 'string') {
      return
    }
    try {
      return new PublicKey(params.address)
    } catch (e) {
      console.error(e)
      return
    }
  }, [params?.address])

  if (!address) {
    return <div>No address provided</div>
  }

  return (
    <div className="container mx-auto px-10 py-10">
      <AccountDetail address={address} />
    </div>
  )
}
