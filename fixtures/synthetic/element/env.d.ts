// Shim so tsc accepts `import App from './App.vue'` (the SFC itself is compiled by @vitejs/plugin-vue).
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
