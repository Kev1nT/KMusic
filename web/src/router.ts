import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '@/lib/api'
import LoginPage from '@/pages/LoginPage.vue'
import AppShell from '@/components/AppShell.vue'
import DashboardPage from '@/pages/DashboardPage.vue'
import SearchPage from '@/pages/SearchPage.vue'
import AppleMusicPage from '@/pages/AppleMusicPage.vue'
import TasksPage from '@/pages/TasksPage.vue'
import LibraryPage from '@/pages/LibraryPage.vue'
import AccountsPage from '@/pages/AccountsPage.vue'
import SettingsPage from '@/pages/SettingsPage.vue'
import AlbumPage from '@/pages/AlbumPage.vue'
import ArtistPage from '@/pages/ArtistPage.vue'
import PlaylistsPage from '@/pages/PlaylistsPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginPage, meta: { public: true } },
    {
      path: '/',
      component: AppShell,
      children: [
        { path: '', name: 'dashboard', component: DashboardPage },
        { path: 'search', name: 'search', component: SearchPage },
        { path: 'apple', name: 'apple', component: AppleMusicPage },
        { path: 'playlists', name: 'playlists', component: PlaylistsPage },
        { path: 'tasks', name: 'tasks', component: TasksPage },
        { path: 'library', name: 'library', component: LibraryPage },
        { path: 'accounts', name: 'accounts', component: AccountsPage },
        { path: 'settings', name: 'settings', component: SettingsPage },
        { path: 'album/:mid', name: 'album', component: AlbumPage },
        { path: 'artist/:mid', name: 'artist', component: ArtistPage },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  if (!to.meta.public && !getToken()) return { name: 'login', query: { next: to.fullPath } }
  if (to.name === 'login' && getToken()) return { name: 'dashboard' }
  return true
})
