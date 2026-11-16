// The standalone (PWA) entry.
import { mount } from 'svelte';
import Root from './Root.svelte';
import './app.css';

mount(Root, { target: document.getElementById('app')! });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
