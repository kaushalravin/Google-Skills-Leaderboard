import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

// The hashed bundle URL changes whenever the code does, so it names a fresh cache without a build step.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const buildId = import.meta.env.VITE_BUILD_ID || new URL(import.meta.url).pathname
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(buildId)}`)
      .catch((error) => console.error('Service worker registration failed', { error }))
  })
}
