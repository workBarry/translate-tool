import { defineConfig } from 'wxt';

export default defineConfig({
  modules: [
    '@wxt-dev/module-vue',
  ],

  manifest: {
    minimum_chrome_version: '138',

    permissions: [
      'storage',
      'tts',
    ],
  },
});
