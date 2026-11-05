import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/App';
import './style.css';
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'knowly-ui', position: 'overlay', anchor: 'body', zIndex: 2147483647,
      onMount(container) {
        const wrapper = document.createElement('div'); container.append(wrapper);
        const root = createRoot(wrapper); root.render(<App />); return root;
      },
      onRemove(root) { root?.unmount(); },
    });
    ui.mount();
  },
});
