import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Brak skonfigurowanych zmiennych EXPO_PUBLIC_SUPABASE_URL lub EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

// Flaga "Zapamiętaj mnie" z ekranu logowania (patrz lib/data/auth.ts,
// setRememberMe) — decyduje, do którego magazynu web trafia sesja:
// localStorage przeżywa zamknięcie przeglądarki, sessionStorage znika po
// zamknięciu karty/przeglądarki. Sama flaga zawsze w localStorage (musi
// przetrwać, żeby było co czytać przy starcie), ustawiana PRZED
// signInWithPassword, żeby supabase-js zapisał token we właściwe miejsce.
const REMEMBER_ME_KEY = 'flowtex-remember-me';

function readRememberMe(): boolean {
  try {
    return typeof window !== 'undefined'
      ? window.localStorage.getItem(REMEMBER_ME_KEY) !== '0'
      : true;
  } catch {
    return true;
  }
}

// Storage niestandardowy tylko na webie — AsyncStorage na webie czyta
// `window` bezwarunkowo, co wywala SSR (renderowanie tras przez
// expo-router na starcie `expo start --web`/`expo export -p web`,
// `window` tam nie istnieje). Ten obiekt odwołuje się do `window` dopiero
// WEWNĄTRZ wywołań metod (w try/catch), nigdy przy jego tworzeniu, więc
// jest bezpieczny w SSR tak samo jak wcześniejsze `storage: undefined`.
const webStorage = {
  getItem(key: string) {
    try {
      return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      if (readRememberMe()) {
        window.localStorage.setItem(key, value);
        window.sessionStorage.removeItem(key);
      } else {
        window.sessionStorage.setItem(key, value);
        window.localStorage.removeItem(key);
      }
    } catch {
      // brak dostępu do storage (np. tryb prywatny) — sesja po prostu nie przetrwa odświeżenia.
    }
  },
  removeItem(key: string) {
    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch {
      // jw.
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? webStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
