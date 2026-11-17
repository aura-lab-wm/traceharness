import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { MODE, refreshEnvironment } from './environment.js'
import { initTheme } from './theme'
import { initWorkspaceTheme } from './workspace/workspaceTheme'

initTheme()
initWorkspaceTheme()

/* The local console asks its backend which runner capabilities this machine has (Docker, the
   runner set up) before the first render; an export, or a backend that does not answer, keeps the
   compiled-in defaults. */
async function start() {
  if (MODE === 'local') await refreshEnvironment() // keeps the defaults when the backend does not answer
  createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
}
start()
