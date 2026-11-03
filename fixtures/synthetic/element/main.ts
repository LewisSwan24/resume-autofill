import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import { createApp } from 'vue';
import App from './App.vue';
import './fixtureState';

document.body.style.margin = '0';
createApp(App).use(ElementPlus).mount('#app');
