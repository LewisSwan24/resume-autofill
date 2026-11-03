import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './fixtureState';

dayjs.locale('zh-cn');
document.body.style.margin = '0';
createRoot(document.getElementById('root')!).render(<App />);
