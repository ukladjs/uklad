import { vi } from 'vitest';

// Mock the current function from immer for testing
vi.mock('immer', async () => {
  const actual = await vi.importActual('immer');
  return {
    ...actual,
    current: vi.fn((obj) => obj),
  };
});
