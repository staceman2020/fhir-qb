import { createContext, useContext } from 'react';
import { createRepository, type Repository } from './db/repository.js';

export const RepoContext = createContext<Repository | null>(null);

let fallback: Repository | undefined;

export function useRepo(): Repository {
  return useContext(RepoContext) ?? (fallback ??= createRepository());
}
