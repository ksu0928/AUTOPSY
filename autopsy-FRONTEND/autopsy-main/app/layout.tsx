import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = { 
  title: 'Metric Autopsy', 
  description: 'Find the segments behind your metric changes.' 
}

export const viewport: Viewport = { 
  colorScheme: 'light dark', 
  themeColor: '#F7F6F3' 
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { 
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
