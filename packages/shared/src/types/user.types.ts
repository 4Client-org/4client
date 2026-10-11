export type UserRole = 'admin' | 'encargado' | 'domiciliario' | 'dev';

export interface User {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface AuthPayload {
  userId: string;
  orgId: string;
  role: UserRole;
  // Id de sesión: solo admin y dev (sesión única, 2026-10-10). Los demás roles no lo llevan.
  sid?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}
