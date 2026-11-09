import { createRouter as create, createWebHistory } from 'vue-router'
import { can, session } from '../../users/web/session'
import type { Permission } from '../../users/domain/permissions'

export function createRouter() {
  const router = create({
    history: createWebHistory(),
    routes: [
      { path: '/', redirect: '/balance' },
      { path: '/login', component: () => import('./LoginPage.vue'), meta: { public: true } },
      { path: '/balance', component: () => import('../../sales/web/BalanceView.vue'), meta: { perm: 'balance.view' } },
      { path: '/productos', component: () => import('../../inventory/web/ProductsView.vue') },
      { path: '/ventas', component: () => import('../../sales/web/SalesListView.vue'), meta: { perm: 'history.view' } },
      { path: '/historial', component: () => import('../../sales/web/HistoryView.vue'), meta: { perm: 'history.view' } },
      { path: '/mas', component: () => import('./MoreView.vue') },
      { path: '/usuarios', component: () => import('../../users/web/UsersView.vue'), meta: { perm: 'users.manage' } },
      { path: '/permisos', component: () => import('../../users/web/PermissionsView.vue') },
      { path: '/ajustes', component: () => import('../../users/web/SettingsView.vue') },
      { path: '/clave', component: () => import('../../users/web/ChangePasswordView.vue') },
      { path: '/sin-permiso', component: () => import('./NoAccessView.vue'), meta: { public: true } },
      { path: '/:pathMatch(.*)*', redirect: '/balance' },
    ],
  })
  router.beforeEach((to) => {
    if (to.meta.public) {
      if (to.path === '/login' && session.user && can('admin.access')) return '/balance'
      return true
    }
    if (!session.user) return { path: '/login', query: { r: to.fullPath } }
    if (!can('admin.access')) return '/sin-permiso'
    const perm = to.meta.perm as Permission | undefined
    if (perm && !can(perm)) return to.path === '/balance' ? '/productos' : '/mas'
  })
  return router
}
