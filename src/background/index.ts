// The layer's test extension in the service worker: it hosts the layer, relays the test panel's messages and runs
// checks. The product's wiring is src/extension/.
import './tabs';
import './layer';
import './spike-session';
import './checks';
import './scenarios';
import './panel-port';
import { startAutorun } from './autorun';

console.info('[background] service worker started');
void startAutorun();
