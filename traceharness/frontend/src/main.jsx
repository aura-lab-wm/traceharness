import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { MODE, refreshEnvironment } from './environment.js'
import { load } from './rig/data'
import { initTheme } from './theme'
import { initWorkspaceTheme } from './workspace/workspaceTheme'

initTheme()
initWorkspaceTheme()

/* The local console asks its backend which runner capabilities this machine has (Docker, the
   runner set up) before the first render; an export, or a backend that does not answer, keeps the
   compiled-in defaults. */
async function start() {
  // the dataset library is asked for while the backend checks Docker, not after: the first page has it sooner
  if (MODE === 'local') load('/overview')
  if (MODE === 'local') await refreshEnvironment() // keeps the defaults when the backend does not answer
  createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
}
start()
