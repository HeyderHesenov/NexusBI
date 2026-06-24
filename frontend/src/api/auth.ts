import { client } from './client'
import type { AuthUser } from '../types'

interface TokenResponse {
  access_token: string
  token_type: string
}

export async function login(email: string, password: string): Promise<string> {
  const { data } = await client.post<TokenResponse>('/auth/login', { email, password })
  return data.access_token
}

export async function register(
  email: string,
  password: string,
  full_name: string,
): Promise<string> {
  const { data } = await client.post<TokenResponse>('/auth/register', {
    email,
    password,
    full_name,
  })
  return data.access_token
}

export async function me(): Promise<AuthUser> {
  const { data } = await client.get<AuthUser>('/auth/me')
  return data
}
