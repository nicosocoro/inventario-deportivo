import { createRouter as create, createWebHistory } from 'vue-router'
import { session } from '../../users/web/session'
import LoginPage from './LoginPage.vue'
import CashRegisterView from '../../sales/web/CashRegisterView.vue'

export function createRouter() {
  const router = create({
    history: createWebHistory(),
    routes: [
      { path: '/', redirect: '/caja' },
      { path: '/login', component: LoginPage, meta: { public: true } },
      // La caja va en el bundle principal (el resto también queda precacheado por el service worker).
      { path: '/caja', component: CashRegisterView },
      { path: '/compras', component: () => import('../../inventory/web/PurchasesView.vue') },
      { path: '/mis-ventas', component: () => import('../../sales/web/MySalesView.vue') },
      { path: '/mas', component: () => import('./MoreView.vue') },
      { path: '/mas/stock', component: () => import('../../inventory/web/StockView.vue') },
      { path: '/mas/estado', component: () => import('./DeviceStatusView.vue') },
      { path: '/mas/clave', component: () => import('../../users/web/ChangePasswordView.vue') },
      { path: '/:pathMatch(.*)*', redirect: '/caja' },
    ],
  })
  router.beforeEach((to) => {
    if (!to.meta.public && !session.user) return { path: '/login', query: { r: to.fullPath } }
    if (to.path === '/login' && session.user) return '/caja'
  })
  return router
}
