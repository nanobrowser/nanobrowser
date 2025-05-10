# Converting Jest Tests to Vitest

This document provides guidance on migrating tests from Jest to Vitest in the mcp-host project.

## Overview

Vitest is designed to be compatible with Jest's API, making migration relatively straightforward. This compatibility includes test file structure, assertions, mocks, and most utility functions.

## Key Differences

1. **Import Statements**
   - Jest: No imports needed for `describe`, `it`, `expect`, etc.
   - Vitest: Either use the globals option (which we've enabled) or explicitly import from Vitest

2. **Configuration**
   - Jest: Configuration in `jest.config.js` or `package.json`
   - Vitest: Configuration in `vitest.config.ts` or `vite.config.ts`

3. **Speed**
   - Vitest generally runs tests faster due to its Vite integration

## Migration Steps

### 1. Basic Test Case Migration

**Jest**
```typescript
// No imports required
describe('My Component', () => {
  it('should work correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Vitest** (with globals)
```typescript
// No imports required if globals: true is set in config
describe('My Component', () => {
  it('should work correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
```

**Vitest** (without globals)
```typescript
import { describe, it, expect } from 'vitest';

describe('My Component', () => {
  it('should work correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
```

### 2. Mocks

**Jest**
```typescript
jest.mock('./service');
const mockFn = jest.fn();
```

**Vitest**
```typescript
import { vi } from 'vitest'; // Only if not using globals

vi.mock('./service');
const mockFn = vi.fn();
```

### 3. Timers

**Jest**
```typescript
jest.useFakeTimers();
jest.advanceTimersByTime(1000);
```

**Vitest**
```typescript
vi.useFakeTimers();
vi.advanceTimersByTime(1000);
```

### 4. Spies

**Jest**
```typescript
const spy = jest.spyOn(object, 'method');
```

**Vitest**
```typescript
const spy = vi.spyOn(object, 'method');
```

## Test File Updates

To migrate a test file:

1. If not using globals, add imports at the top of the file:
   ```typescript
   import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
   ```

2. Replace Jest-specific functions with their Vitest equivalents:
   - `jest.fn()` → `vi.fn()`
   - `jest.mock()` → `vi.mock()`
   - `jest.spyOn()` → `vi.spyOn()`

3. If using Jest snapshots, they should work with Vitest without changes

## Running Both Test Frameworks

During the transition period, both Jest and Vitest are configured to run:

```
# Run tests with Vitest
npm run test
npm run test:unit
npm run test:integration

# Run tests with Jest
npm run test:jest
npm run test:jest:unit
npm run test:jest:integration
```

This allows for a gradual transition while ensuring all tests continue to pass.

## Benefits of Vitest

- Faster test execution due to Vite's fast module resolution and transformation
- Better TypeScript support out of the box
- Integrated with Vite's development workflow
- Enhanced watch mode and UI for test results
- Compatible with existing Jest tests for seamless migration

## Complete Example

**Original Jest Test**
```typescript
// tests/unit/example.test.ts
const { describe, test, expect } = require('@jest/globals');
jest.mock('../../src/service');

describe('Example Test', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('should perform calculation', () => {
    const result = someFunction();
    expect(result).toBe(42);
    expect(mockService.callCount).toBe(1);
  });
});
```

**Migrated Vitest Test**
```typescript
// tests/unit/example.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../../src/service');

describe('Example Test', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should perform calculation', () => {
    const result = someFunction();
    expect(result).toBe(42);
    expect(mockService.callCount).toBe(1);
  });
});
