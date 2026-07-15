import { vi } from 'vitest';

// Handler tests use plain objects instead of Immer drafts, so snapshots are identity values.
vi.mock('immer', async () => {
  const actual = await vi.importActual('immer');
  return {
    ...actual,
    current: vi.fn((obj) => obj),
  };
});
