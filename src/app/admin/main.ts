import { createApp } from 'vue'
import '../../shared/styles.css'
import App from './App.vue'
import { createRouter } from './router'
import { ServicesKey, createServices } from '../../shared/container'
import { initSession } from '../../users/web/session'

const services = createServices()
await initSession(services)

createApp(App).provide(ServicesKey, services).use(createRouter()).mount('#app')
