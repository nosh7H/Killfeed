import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { LocalStore } from './local.js';

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export async function createStore() {
  if (cloudConfigured) {
    const { SupabaseStore } = await import('./supabase.js');
    const s = new SupabaseStore();
    await s.init();
    return s;
  }
  const s = new LocalStore();
  await s.init();
  return s;
}
