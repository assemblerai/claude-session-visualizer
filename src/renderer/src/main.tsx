import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { createTrpcClient, trpc } from './trpc'
import './index.css'

function Root(): React.JSX.Element {
  // Created once per mount, not per render.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // IPC is local: no network to lose, and refetch-on-focus is noise.
          queries: { refetchOnWindowFocus: false, retry: false, staleTime: 5_000 },
        },
      }),
  )
  const [trpcClient] = useState(createTrpcClient)

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('renderer: #root missing from index.html')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
