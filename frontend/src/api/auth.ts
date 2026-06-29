import { client } from './client'
import type { AuthProviders, AuthUser } from '../types'

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const { data } = await client.post<TokenPair>('/auth/login', { email, password })
  return data
}

export async function register(
  email: string,
  password: string,
  full_name: string,
): Promise<TokenPair> {
  const { data } = await client.post<TokenPair>('/auth/register', {
    email,
    password,
    full_name,
  })
  return data
}

export async function googleLogin(credential: string): Promise<TokenPair> {
  const { data } = await client.post<TokenPair>('/auth/google', { credential })
  return data
}

export async function logout(refreshToken: string): Promise<void> {
  await client.post('/auth/logout', { refresh_token: refreshToken })
}

export async function me(): Promise<AuthUser> {
  const { data } = await client.get<AuthUser>('/auth/me')
  return data
}

export async function getProviders(): Promise<AuthProviders> {
  const { data } = await client.get<AuthProviders>('/auth/providers')
  return data
}
