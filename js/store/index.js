import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { LocalStore } from './local.js';

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// A visitor who clicked "Try the demo" uses the in-browser store for this tab session.
export const inDemoSession = () => cloudConfigured && sessionStorage.getItem('kf-demo') === '1';

export function startDemo() {
  sessionStorage.setItem('kf-demo', '1');
  sessionStorage.setItem('kf-demo-seed', '1');
  location.hash = '#/';
  location.reload();
}

export function exitDemo() {
  sessionStorage.removeItem('kf-demo');
  sessionStorage.removeItem('kf-demo-seed');
  sessionStorage.removeItem('kf-filters');
  location.hash = '#/';
  location.reload();
}

export async function createStore() {
  if (cloudConfigured && !inDemoSession()) {
    const { SupabaseStore } = await import('./supabase.js');
    const s = new SupabaseStore();
    await s.init();
    return s;
  }
  const s = new LocalStore();
  await s.init();
  return s;
}
