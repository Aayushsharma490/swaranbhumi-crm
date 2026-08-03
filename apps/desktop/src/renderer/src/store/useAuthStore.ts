import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'EXECUTIVE';
  status: 'ACTIVE' | 'INACTIVE';
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  apiBaseUrl: string;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setApiBaseUrl: (url: string) => void;
}

// Retrieve initial API base URL from localStorage if set, default to production domain
const getStoredApiBase = () => {
  try {
    return localStorage.getItem('SB_CRM_API_URL') || 'https://api.swaranbhumi.com';
  } catch {
    return 'https://api.swaranbhumi.com';
  }
};

export const useAuthStore = create<AuthState>((set) => {
  // Load state from local storage securely (electron process manages context, standard localStorage is fine)
  // Start clean on launch to trigger fresh auto-login and prevent expired 401 loops
  const initialUser = null;
  const initialAccess = null;
  const initialRefresh = null;

  return {
    user: initialUser,
    accessToken: initialAccess,
    refreshToken: initialRefresh,
    apiBaseUrl: getStoredApiBase(),

    setAuth: (user, accessToken, refreshToken) => {
      try {
        localStorage.setItem('SB_CRM_USER', JSON.stringify(user));
        localStorage.setItem('SB_CRM_ACCESS_TOKEN', accessToken);
        localStorage.setItem('SB_CRM_REFRESH_TOKEN', refreshToken);
      } catch (err) {
        console.error(err);
      }
      set({ user, accessToken, refreshToken });
    },

    logout: () => {
      try {
        localStorage.removeItem('SB_CRM_USER');
        localStorage.removeItem('SB_CRM_ACCESS_TOKEN');
        localStorage.removeItem('SB_CRM_REFRESH_TOKEN');
        localStorage.removeItem('SB_CRM_LOGIN_CREDENTIALS');
      } catch (err) {
        console.error(err);
      }
      set({ user: null, accessToken: null, refreshToken: null });
    },

    setApiBaseUrl: (url) => {
      try {
        localStorage.setItem('SB_CRM_API_URL', url);
      } catch (err) {
        console.error(err);
      }
      set({ apiBaseUrl: url });
    }
  };
});
