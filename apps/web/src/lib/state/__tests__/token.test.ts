import { describe, it, expect, beforeEach } from 'vitest';
import { setToken, clearToken, hasToken, getToken, authHeader } from '../token.svelte.js';

/**
 * Token state unit tests.
 *
 * The token module uses Svelte 5 `$state` runes. In a Vitest jsdom environment,
 * `$state` compiles to a reactive variable that behaves as a regular variable
 * for get/set operations. These tests verify the exported function behavior,
 * not the Svelte reactivity internals.
 */

describe('token state', () => {
  // Ensure clean state before each test
  beforeEach(() => {
    clearToken();
  });

  describe('setToken', () => {
    it('stores token in memory only (not localStorage, sessionStorage, or cookies)', () => {
      setToken('test-token-123');

      // Token must NOT appear in any persistent storage
      expect(localStorage.getItem('operator_token')).toBeNull();
      expect(localStorage.getItem('token')).toBeNull();
      expect(sessionStorage.getItem('operator_token')).toBeNull();
      expect(sessionStorage.getItem('token')).toBeNull();
      expect(document.cookie).not.toContain('test-token-123');
      expect(document.cookie).not.toContain('operator_token');

      // Token must be accessible via the module's exported functions
      expect(hasToken()).toBe(true);
      expect(getToken()).toBe('test-token-123');
    });
  });

  describe('clearToken', () => {
    it('clears the token from memory', () => {
      setToken('test-token');
      expect(hasToken()).toBe(true);

      clearToken();

      expect(hasToken()).toBe(false);
      expect(getToken()).toBeNull();
      expect(authHeader()).toBeNull();
    });

    it('is idempotent (calling clearToken when no token is set does not throw)', () => {
      // Should not throw when no token is set
      expect(() => clearToken()).not.toThrow();
      expect(hasToken()).toBe(false);
    });
  });

  describe('hasToken', () => {
    it('returns false when no token is set', () => {
      expect(hasToken()).toBe(false);
    });

    it('returns true when a token is set', () => {
      setToken('any-token');
      expect(hasToken()).toBe(true);
    });

    it('returns false after clearToken', () => {
      setToken('any-token');
      clearToken();
      expect(hasToken()).toBe(false);
    });
  });

  describe('getToken', () => {
    it('returns null when no token is set', () => {
      expect(getToken()).toBeNull();
    });

    it('returns the token value when set', () => {
      setToken('my-secret-token');
      expect(getToken()).toBe('my-secret-token');
    });

    it('returns null after clearToken', () => {
      setToken('my-secret-token');
      clearToken();
      expect(getToken()).toBeNull();
    });
  });

  describe('authHeader', () => {
    it('returns null when no token is set', () => {
      expect(authHeader()).toBeNull();
    });

    it('returns Bearer format when token is set', () => {
      setToken('my-token');
      expect(authHeader()).toBe('Bearer my-token');
    });

    it('returns null after clearToken', () => {
      setToken('my-token');
      clearToken();
      expect(authHeader()).toBeNull();
    });
  });

  describe('initial state (simulates page reload)', () => {
    it('hasToken returns false before any setToken call', () => {
      // The module starts with tokenValue = null (initial $state).
      // beforeEach already calls clearToken(), so this is the initial state.
      expect(hasToken()).toBe(false);
    });

    it('getToken returns null before any setToken call', () => {
      expect(getToken()).toBeNull();
    });

    it('authHeader returns null before any setToken call', () => {
      expect(authHeader()).toBeNull();
    });
  });
});
