import { describe, it, expect } from 'vitest';
import {
  errorResponse,
  badRequestResponse,
  internalErrorResponse,
  unauthorizedResponse,
  unavailableResponse,
  conflictErrorResponse,
  validationErrorResponse,
} from '../src/lib/errors.js';
// ---------------------------------------------------------------------------
// errorResponse
// ---------------------------------------------------------------------------

describe('errorResponse', () => {
  it('produces correct shape with code, message, and status', async () => {
    const res = errorResponse('TEST_CODE', 'Test message', 418);
    const body = await res.json();

    expect(res.status).toBe(418);
    expect(body.error.code).toBe('TEST_CODE');
    expect(body.error.message).toBe('Test message');
    expect(body.error.request_id).toBeUndefined();
    expect(body.error.details).toBeUndefined();
  });

  it('includes request_id when passed', async () => {
    const res = errorResponse('TEST_CODE', 'Test message', 400, 'req-abc-123');
    const body = await res.json();

    expect(body.error.request_id).toBe('req-abc-123');
  });

  it('does NOT include request_id when undefined', async () => {
    const res = errorResponse('TEST_CODE', 'Test message', 400, undefined);
    const body = await res.json();

    expect(body.error.request_id).toBeUndefined();
    // Ensure the key is not present at all
    expect('request_id' in body.error).toBe(false);
  });

  it('does NOT include request_id when omitted (3-arg call)', async () => {
    const res = errorResponse('TEST_CODE', 'Test message', 400);
    const body = await res.json();

    expect(body.error.request_id).toBeUndefined();
    expect('request_id' in body.error).toBe(false);
  });

  it('includes details when passed', async () => {
    const details = { field_errors: { name: ['Required'] } };
    const res = errorResponse('TEST_CODE', 'Test message', 400, undefined, details);
    const body = await res.json();

    expect(body.error.details).toEqual(details);
  });

  it('does NOT include details when not passed', async () => {
    const res = errorResponse('TEST_CODE', 'Test message', 400);
    const body = await res.json();

    expect(body.error.details).toBeUndefined();
    expect('details' in body.error).toBe(false);
  });

  it('includes both request_id and details when both passed', async () => {
    const details = { extra: 'info' };
    const res = errorResponse('TEST_CODE', 'Test message', 400, 'req-xyz', details);
    const body = await res.json();

    expect(body.error.request_id).toBe('req-xyz');
    expect(body.error.details).toEqual(details);
  });

  it('returns correct Content-Type header', () => {
    const res = errorResponse('TEST_CODE', 'Test message', 400);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// badRequestResponse
// ---------------------------------------------------------------------------

describe('badRequestResponse', () => {
  it('has code BAD_REQUEST and status 400', async () => {
    const res = badRequestResponse('Missing field');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Missing field');
  });

  it('includes request_id when passed', async () => {
    const res = badRequestResponse('Missing field', 'req-001');
    const body = await res.json();

    expect(body.error.request_id).toBe('req-001');
  });

  it('omits request_id when not passed', async () => {
    const res = badRequestResponse('Missing field');
    const body = await res.json();

    expect(body.error.request_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// internalErrorResponse
// ---------------------------------------------------------------------------

describe('internalErrorResponse', () => {
  it('has code INTERNAL_ERROR and status 500', async () => {
    const res = internalErrorResponse('Something broke');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Something broke');
  });

  it('includes request_id when passed', async () => {
    const res = internalErrorResponse('Something broke', 'req-err-500');
    const body = await res.json();

    expect(body.error.request_id).toBe('req-err-500');
  });
});

// ---------------------------------------------------------------------------
// unauthorizedResponse
// ---------------------------------------------------------------------------

describe('unauthorizedResponse', () => {
  it('has default message "Unauthorized" when no message passed', async () => {
    const res = unauthorizedResponse();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Unauthorized');
  });

  it('uses custom message when passed', async () => {
    const res = unauthorizedResponse('Invalid token');
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid token');
  });

  it('includes request_id when passed', async () => {
    const res = unauthorizedResponse('Invalid token', 'req-auth-1');
    const body = await res.json();

    expect(body.error.request_id).toBe('req-auth-1');
  });

  it('omits request_id when not passed', async () => {
    const res = unauthorizedResponse();
    const body = await res.json();

    expect(body.error.request_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// unavailableResponse
// ---------------------------------------------------------------------------

describe('unavailableResponse', () => {
  it('has code UNAVAILABLE and status 503', async () => {
    const res = unavailableResponse('Service down for maintenance');
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe('UNAVAILABLE');
    expect(body.error.message).toBe('Service down for maintenance');
  });

  it('includes request_id when passed', async () => {
    const res = unavailableResponse('Service down', 'req-503');
    const body = await res.json();

    expect(body.error.request_id).toBe('req-503');
  });
});

// ---------------------------------------------------------------------------
// conflictErrorResponse
// ---------------------------------------------------------------------------

describe('conflictErrorResponse', () => {
  it('uses custom code and status 409', async () => {
    const res = conflictErrorResponse('DUPLICATE_TX', 'Transaction already processed');
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('DUPLICATE_TX');
    expect(body.error.message).toBe('Transaction already processed');
  });

  it('includes request_id when passed', async () => {
    const res = conflictErrorResponse('DUPLICATE_TX', 'Already exists', 'req-conflict');
    const body = await res.json();

    expect(body.error.request_id).toBe('req-conflict');
  });
});

// ---------------------------------------------------------------------------
// validationErrorResponse
// ---------------------------------------------------------------------------

describe('validationErrorResponse', () => {
  it('has code VALIDATION_ERROR and status 422', async () => {
    const zodError = { issues: [{ path: ['name'], message: 'Required' }] };
    const res = validationErrorResponse(zodError);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Request body validation failed');
  });

  it('produces correct field_errors structure', async () => {
    const zodError = {
      issues: [
        { path: ['name'], message: 'Required' },
        { path: ['name'], message: 'Must be at least 3 characters' },
        { path: ['email'], message: 'Invalid email format' },
      ],
    };
    const res = validationErrorResponse(zodError);
    const body = await res.json();

    expect(body.error.details).toEqual({
      field_errors: {
        name: ['Required', 'Must be at least 3 characters'],
        email: ['Invalid email format'],
      },
    });
  });

  it('groups issues by first path element', async () => {
    const zodError = {
      issues: [
        { path: ['user', 'name'], message: 'Required' },
        { path: ['user', 'email'], message: 'Invalid' },
        { path: ['settings', 'theme'], message: 'Unknown theme' },
      ],
    };
    const res = validationErrorResponse(zodError);
    const body = await res.json();

    expect(body.error.details).toEqual({
      field_errors: {
        user: ['Required', 'Invalid'],
        settings: ['Unknown theme'],
      },
    });
  });

  it('handles empty path (uses "root")', async () => {
    const zodError = {
      issues: [{ path: [], message: 'Object must have at least one field' }],
    };
    const res = validationErrorResponse(zodError);
    const body = await res.json();

    expect(body.error.details).toEqual({
      field_errors: {
        root: ['Object must have at least one field'],
      },
    });
  });

  it('handles numeric path (converts to string)', async () => {
    const zodError = {
      issues: [
        { path: [0, 'name'], message: 'Required' },
        { path: [1, 'name'], message: 'Required' },
      ],
    };
    const res = validationErrorResponse(zodError);
    const body = await res.json();

    expect(body.error.details).toEqual({
      field_errors: {
        '0': ['Required'],
        '1': ['Required'],
      },
    });
  });

  it('includes request_id when passed', async () => {
    const zodError = { issues: [{ path: ['name'], message: 'Required' }] };
    const res = validationErrorResponse(zodError, 'req-val-1');
    const body = await res.json();

    expect(body.error.request_id).toBe('req-val-1');
  });

  it('omits request_id when not passed', async () => {
    const zodError = { issues: [{ path: ['name'], message: 'Required' }] };
    const res = validationErrorResponse(zodError);
    const body = await res.json();

    expect(body.error.request_id).toBeUndefined();
  });

  it('handles mixed path types (string and number)', async () => {
    const zodError = {
      issues: [
        { path: ['items', 0, 'label'], message: 'Required' },
        { path: ['items', 1, 'label'], message: 'Too long' },
        { path: ['title'], message: 'Required' },
      ],
    };
    const res = validationErrorResponse(zodError);
    const body = await res.json();

    expect(body.error.details).toEqual({
      field_errors: {
        items: ['Required', 'Too long'],
        title: ['Required'],
      },
    });
  });
});
