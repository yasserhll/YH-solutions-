import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Department, Position, Site } from '../types';

export function useSites() {
  return useQuery({ queryKey: ['sites'], queryFn: () => api.get<Site[]>('/sites').then((r) => r.data) });
}

export function useDepartments() {
  return useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments').then((r) => r.data) });
}

export function usePositions() {
  return useQuery({ queryKey: ['positions'], queryFn: () => api.get<Position[]>('/positions').then((r) => r.data) });
}
