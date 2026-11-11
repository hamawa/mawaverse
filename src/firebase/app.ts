import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';

const env = import.meta.env;
export const useEmulator = env.VITE_USE_EMULATOR === '1';

const config = useEmulator
  ? {
      apiKey: 'demo-api-key',
      authDomain: 'demo-mawaverse.firebaseapp.com',
      projectId: 'demo-mawaverse',
      databaseURL: 'https://demo-mawaverse-default-rtdb.firebaseio.com',
      appId: 'demo-app',
    }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY as string,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
      projectId: env.VITE_FIREBASE_PROJECT_ID as string,
      databaseURL: env.VITE_FIREBASE_DATABASE_URL as string,
      appId: env.VITE_FIREBASE_APP_ID as string,
    };

export const isConfigured = useEmulator || !!(config.apiKey && config.databaseURL);

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getDatabase(app);

if (useEmulator) {
  // localhost 는 IPv6(::1)로 풀릴 수 있어 에뮬레이터(127.0.0.1)에 못 붙는 경우가 있음
  const host = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(db, host, 9000);
}
