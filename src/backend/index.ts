export * from './types';

export const BACKEND_URI =
  process.env.BACKEND_URI || 'ws://localhost:8000/subscriptions';
