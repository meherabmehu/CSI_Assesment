import { createServer } from 'node:net';
import { once } from 'node:events';
import { Aedes } from 'aedes';

// Keep the laptop demo entirely on loopback, including MQTT.
const broker = await Aedes.createBroker();
const listener = createServer(broker.handle);
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
process.env.HOST = '127.0.0.1';
process.env.PORT = '3000';
process.env.MQTT_ENABLED = 'true';
process.env.MQTT_BROKER_URL = `mqtt://127.0.0.1:${listener.address().port}`;
console.log(`Local MQTT broker: ${process.env.MQTT_BROKER_URL}`);
try {
  await import('../src/server.js');
  if (process.exitCode) {
    await new Promise(resolve => broker.close(resolve));
    await new Promise(resolve => listener.close(resolve));
  }
} catch (error) {
  await new Promise(resolve => broker.close(resolve));
  await new Promise(resolve => listener.close(resolve));
  throw error;
}
