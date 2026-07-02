import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthUser, UserRole, AccessStatus } from '../lib/types/types';
import { invalidateApiCache } from '../lib/api/client';
import { getMe } from '../lib/api/users';
import { dropAll as dropAllPositionsCache } from '../lib/cache/clientPositionsCache';
import { invalidateAll as dropAllPositionRows } from '../lib/cache/positionRowCache';
import {
  hydrate as hydrateAppAuth,
  me as appAuthMe,
  onAuthStateChange as onAppAuthStateChange,
  signOut as appAuthSignOut,
} from '../lib/auth/client';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

// Загрузка профиля + роли + allowed_pages одним запросом к Go BFF (/api/v1/me).
// JWT уже задаёт user_id на сервере — клиент не подменит чужой профиль.
const loadUserData = async (authUserId: string): Promise<AuthUser | null> => {
  try {
    console.log('[AuthContext] Загрузка пользователя:', authUserId);
    const me = await getMe();
    return {
      id: me.id,
      email: me.email,
      full_name: me.full_name,
      role: (me.role_name as UserRole) || 'Инженер',
      role_code: me.role_code,
      role_color: me.role_color || undefined,
      access_status: me.access_status as AccessStatus,
      allowed_pages: me.allowed_pages || [],
      access_enabled: me.access_enabled,
    };
  } catch (err) {
    console.error('[AuthContext] Ошибка загрузки пользователя:', err);
    return null;
  }
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    // /auth/me touches the BFF to refresh access_status / allowed_pages
    // in the cached session, then we re-load the full /me payload (with
    // role_name + role_color).
    const u = await appAuthMe();
    if (!u) {
      setUser(null);
      return;
    }
    const full = await loadUserData(u.id);
    setUser(full);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await appAuthSignOut();
      setUser(null);
      invalidateApiCache();
      dropAllPositionsCache();
      dropAllPositionRows();
    } catch (error) {
      console.error('[AuthContext] Ошибка при выходе:', error);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const handleSession = (event: string, hasSession: boolean, userId: string | null) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !hasSession || !userId) {
        setUser(null);
        setLoading(false);
        return;
      }
      // We have a session; do a full /api/v1/me load so role_name + role_color
      // are populated (the app-auth /auth/me only returns role_code; the
      // legacy /me JOINs roles).
      setTimeout(async () => {
        if (!mounted) return;
        const userData = await loadUserData(userId);
        if (!mounted) return;
        setUser(userData);
        setLoading(false);
      }, 0);
    };

    const { data: { subscription } } = onAppAuthStateChange((event, session) => {
      handleSession(event, !!session, session?.user.id ?? null);
    });

    // Kick off initial hydrate (emits INITIAL_SESSION synchronously into
    // the listener above).
    hydrateAppAuth();

    // Best-effort /auth/me to refresh access_status / allowed_pages in
    // case admin made a change while the user was logged out. The emitted
    // USER_UPDATED event will flow through the subscription.
    appAuthMe().catch(() => undefined);

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuthWithNavigation = () => {
  const auth = useAuth();
  const navigate = useNavigate();

  const signOutAndRedirect = useCallback(async () => {
    await auth.signOut();
    navigate('/login', { replace: true });
  }, [auth, navigate]);

  return {
    ...auth,
    signOut: signOutAndRedirect,
  };
};
