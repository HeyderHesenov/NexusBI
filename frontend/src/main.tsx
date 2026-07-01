import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './i18n'
import { bootstrapLanguage } from './store/localeStore'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './index.css'

// Apply the saved language before first paint so a returning EN/RU/TR user
// doesn't see an Azerbaijani flash. Renders regardless if the bundle fails.
bootstrapLanguage().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
})
