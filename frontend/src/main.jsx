import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App.jsx'
import { ThemeProvider } from './components/theme-provider.jsx'
import { TooltipProvider } from './components/ui/tooltip.jsx'
import './styles/index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      storageKey="vite-ui-theme"
    >
      <TooltipProvider delayDuration={120}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
