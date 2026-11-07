import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SimulationWorkspace from './simulation/SimulationWorkspace'
import './style.css'

createRoot(document.getElementById('root')!).render(<StrictMode><SimulationWorkspace /></StrictMode>)
