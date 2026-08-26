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
      // Sesja zostaje w tym magazynie, w którym już żyje — NIE przeliczamy
      // "do którego magazynu pisać" na nowo przy każdym zapisie (a
      // supabase-js zapisuje tu też przy zwykłym odświeżeniu tokenu w tle,
      // nie tylko przy logowaniu). REMEMBER_ME_KEY jest per-przeglądarka
      // (localStorage), więc zmiana checkboxa w JEDNEJ karcie/logowaniu
      // wpływała retroaktywnie na WSZYSTKIE inne otwarte karty: kolejne
      // auto-odświeżenie tokenu w takiej karcie przełączało jej już
      // aktywną sesję do innego magazynu niż ten, z którego ją pierwotnie
      // odczytano, a w wariancie "przenieś do sessionStorage" jawnie
      // kasowało kopię w localStorage — więc po zamknięciu i ponownym
      // otwarciu przeglądarki (świeży sessionStorage) użytkownik nagle
      // wypadał z sesji mimo zaznaczonego "nie wylogowuj mnie". Dokładnie
      // to objawiało się jako "logowanie działa na telefonie, a w
      // przeglądarce nie" — natywny AsyncStorage nie ma tego rozdwojenia.
      // Dopiero brak wartości w OBU magazynach (świeże logowanie) korzysta
      // z aktualnej flagi.
      const inLocal = window.localStorage.getItem(key) !== null;
      const inSession = window.sessionStorage.getItem(key) !== null;
      const useLocal = inLocal ? true : inSession ? false : readRememberMe();
      if (useLocal) {
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
