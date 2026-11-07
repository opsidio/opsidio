import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import StandaloneSimulation from './simulation/StandaloneSimulation'
import './scene-page.css'

createRoot(document.getElementById('root')!).render(<StrictMode><StandaloneSimulation /></StrictMode>)
