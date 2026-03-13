import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import type { User } from '@/types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: User['role'][];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    // Rediriger vers le dashboard approprié selon le rôle
    if (user.role === 'SUPER_ADMIN') {
      return <Navigate to="/superadmin/dashboard" replace />;
    } else if (user.role === 'ADMIN') {
      return <Navigate to="/admin/dashboard" replace />;
    } else if (user.role === 'VENDEUR') {
      return <Navigate to="/vendor/dashboard" replace />;
    }
  }

  return <>{children}</>;
}