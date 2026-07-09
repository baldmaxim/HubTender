import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import { initSentry } from './lib/sentry'
import 'antd/dist/reset.css'
import './index.css'
import './styles/transitions/index.css'

initSentry()

// Регистрируем service worker вручную с обработкой ошибки: транзиентный сбой
// сети при загрузке /sw.js (окно деплоя, редирект с /login) не должен всплывать
// в Sentry как unhandledrejection.
registerSW({
  immediate: true,
  onRegisterError() {
    /* некритично — молча игнорируем сбой регистрации SW */
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)