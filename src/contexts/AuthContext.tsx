import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { AuthUser, UserRole, AccessStatus } from '../lib/supabase/types';
import { invalidateApiCache } from '../lib/api/client';
import { getMe } from '../lib/api/users';
import { dropAll as dropAllPositionsCache } from '../lib/cache/clientPositionsCache';
import { invalidateAll as dropAllPositionRows } from '../lib/cache/positionRowCache';

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
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const userData = await loadUserData(session.user.id);
      setUser(userData);
    } else {
      setUser(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
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

    // ВАЖНО: callback НЕ async. Supabase-запросы выносим в setTimeout,
    // чтобы не получить deadlock на внутреннем auth-lock GoTrueClient.
    // См. https://supabase.com/docs/reference/javascript/auth-onauthstatechange
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_OUT' || !session?.user) {
        setUser(null);
        setLoading(false);
        return;
      }

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const authUserId = session.user.id;
        setTimeout(async () => {
          if (!mounted) return;
          const userData = await loadUserData(authUserId);
          if (!mounted) return;
          setUser(userData);
          setLoading(false);
        }, 0);
      }
    });

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
