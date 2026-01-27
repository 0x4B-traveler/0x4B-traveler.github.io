import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // 部署到 GitHub Pages 时，这里填写你的 GitHub Pages 网址
  // 例如：https://<username>.github.io
  site: 'https://0x4b-traveler.github.io/',
  
  // 如果你的仓库名称不是 <username>.github.io，则需要设置 base 为仓库名称
  // 例如：如果仓库名是 my-blog，则设置为 '/my-blog'
  // base: '/my-blog',
});
