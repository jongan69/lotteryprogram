'use client'

import { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string
}

export function Button({ className, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'rounded-md bg-primary px-4 py-2 text-white hover:bg-primary/90 disabled:opacity-50',
        className
      )}
      disabled={disabled}
      {...props}
    />
  )
} 