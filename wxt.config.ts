import { defineConfig } from 'wxt';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Knowly · AI 伴学',
    description: '划词后就地查看概念解释。',
    permissions: ['clipboardWrite', 'storage'],
    host_permissions: [
      'https://api.deepseek.com/*',
      'https://open.bigmodel.cn/*',
      'https://ark.cn-beijing.volces.com/*',
    ],
  },
});
