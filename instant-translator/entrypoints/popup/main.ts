import {
  createApp,
} from 'vue';

import App from './App.vue';

import './style.css';

const mountPoint =
  document.querySelector(
    '#app',
  );

if (!mountPoint) {
  throw new Error(
    '找不到 Popup 掛載節點 #app',
  );
}

createApp(App).mount(
  mountPoint,
);