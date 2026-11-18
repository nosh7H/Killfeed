import { h, toast } from '../ui.js';
import { state } from '../state.js';
import { SITE_NAME } from '../config.js';

export function authView() {
  let mode = 'signin';
  const email = h('input', { type: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com' });
  const pw = h('input', { type: 'password', required: true, minlength: 6, autocomplete: 'current-password', placeholder: '••••••••' });
  const title = h('h2', {}, 'Sign in');
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
  const toggle = h('button', { type: 'button', class: 'link' }, 'Need an account? Sign up');
  const msg = h('p', { class: 'muted small' });

  const setMode = m => {
    mode = m;
    title.textContent = m === 'signin' ? 'Sign in' : 'Create account';
    submit.textContent = m === 'signin' ? 'Sign in' : 'Sign up';
    toggle.textContent = m === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in';
    pw.autocomplete = m === 'signin' ? 'current-password' : 'new-password';
  };
  toggle.onclick = () => setMode(mode === 'signin' ? 'signup' : 'signin');

  const form = h('form', {
    class: 'card auth-card',
    onsubmit: async e => {
      e.preventDefault();
      submit.disabled = true;
      try {
        if (mode === 'signin') await state.store.signIn(email.value, pw.value);
        else {
          const r = await state.store.signUp(email.value, pw.value);
          if (r.needsConfirm) msg.textContent = 'Check your email to confirm your account, then sign in.';
        }
      } catch (err) { toast(err.message, 'error'); }
      submit.disabled = false;
    },
  },
  title,
  h('label', {}, 'Email', email),
  h('label', {}, 'Password', pw),
  submit,
  h('div', { class: 'row-between' }, toggle,
    h('button', {
      type: 'button', class: 'link', onclick: async () => {
        if (!email.value) return toast('Enter your email first', 'error');
        try { await state.store.magicLink(email.value); msg.textContent = 'Sign-in link sent — check your email.'; }
        catch (err) { toast(err.message, 'error'); }
      },
    }, 'Email me a sign-in link')),
  msg);

  return h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-hero' },
      h('h1', {}, SITE_NAME),
      h('p', { class: 'lead' }, 'Scrim and match stats for Call of Duty teams.'),
      h('ul', { class: 'ticks' },
        h('li', {}, 'Upload scoreboard screenshots and pull stats automatically'),
        h('li', {}, 'Filter K/D, obj time, plants and defuses by map and mode'),
        h('li', {}, 'Private team spaces with invite codes'),
        h('li', {}, 'VOD review with timestamped notes'))),
    form);
}
