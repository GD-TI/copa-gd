import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: '#1a2035',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.1)',
        },
        success: { iconTheme: { primary: '#009c3b', secondary: '#fff' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
      }}
    />
  </>
)
