import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { initSentry } from './lib/sentry'
import 'antd/dist/reset.css'
import './index.css'
import './styles/transitions/index.css'

initSentry()

// Service worker регистрирует UpdateBanner (useRegisterSW): только так компонент
// получает needRefresh и функцию применения обновления по кнопке «Обновить».

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)