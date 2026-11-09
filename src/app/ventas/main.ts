import { createApp } from 'vue'
import '../../shared/styles.css'
import App from './App.vue'
import { createRouter } from './router'
import { ServicesKey, createServices } from '../../shared/container'
import { initSession } from '../../users/web/session'
import { loadCatalogFromCache } from '../../inventory/web/catalog'

const services = createServices()
await Promise.all([initSession(services), loadCatalogFromCache(services)])

createApp(App).provide(ServicesKey, services).use(createRouter()).mount('#app')
