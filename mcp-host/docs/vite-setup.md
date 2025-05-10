# Using Vite with MCP Host

This document provides information on how to use Vite for development and building of the MCP Host.

## Overview

MCP Host now supports Vite as a build and development tool, which offers several advantages over traditional TypeScript compilation:

- Faster development with hot module replacement (HMR)
- Improved build performance
- Better dev experience with instant feedback
- Modern development features

## Getting Started

### Installation

The required Vite dependencies should already be in the package.json. If you need to install them manually, run:

```bash
./install-vite-deps.sh
```

Or manually install the dependencies:

```bash
pnpm add -D vite vitest vite-plugin-node vite-tsconfig-paths
```

### Development Mode

To start the development server:

```bash
pnpm run dev
```

This will:
1. Start Vite's development server
2. Watch for file changes
3. Provide hot module replacement
4. Run the Express app through Vite's development server

The development server will be available at: http://localhost:8765

### Building for Production

To build the project for production:

```bash
pnpm run build
```

This creates optimized JavaScript files in the `dist` directory.

### Running the Production Build

To run the built application:

```bash
pnpm run start
```

This runs the application from the built files in the `dist` directory.

## Project Structure

The Vite setup includes:

- `vite.config.ts` - Main Vite configuration
- `vitest.config.ts` - Vitest (testing) configuration
- `src/index.ts` - Main entry point that exports the Express app
- `src/server.ts` - Server entry point for running outside Vite

## Testing

### Running Tests with Vitest

```bash
# Run all tests
pnpm run test

# Run tests and watch for changes
pnpm run test:watch

# Run unit tests only
pnpm run test:unit

# Run integration tests only
pnpm run test:integration
```

### Running Tests with Jest (Legacy)

During the transition period, Jest tests can still be run:

```bash
# Run all tests with Jest
pnpm run test:jest

# Run unit tests with Jest
pnpm run test:jest:unit

# Run integration tests with Jest
pnpm run test:jest:integration
```

See [Converting Jest Tests to Vitest](./jest-to-vitest.md) for information on migrating tests.

## Configuration Details

### Vite Configuration

The `vite.config.ts` file configures Vite with:

- Node.js compatibility through vite-plugin-node
- Multiple entry points (index.ts and server.ts)
- External dependencies
- Development server settings

### Vitest Configuration

The `vitest.config.ts` file configures Vitest with:

- Globals mode for Jest compatibility
- Test file patterns
- Code coverage settings

## Troubleshooting

### Common Issues

1. **TypeScript Errors with Vite Plugins**

   If you see errors like "Cannot find module 'vite-plugin-node'", make sure you've installed the dependencies:
   
   ```bash
   pnpm install
   ```

2. **Port Already in Use**

   If port 8765 is already in use, you can change it in `vite.config.ts`:
   
   ```typescript
   server: {
     port: 8766, // Change to an available port
     host: 'localhost'
   }
   ```

3. **Build Errors**

   If you encounter build errors, try running:
   
   ```bash
   pnpm run build:tsc
   ```
   
   to see if there are TypeScript errors that need to be fixed.

## Migration Notes

- The project is configured to support both traditional TypeScript compilation and Vite
- Scripts have been added to package.json to support both build systems
- The Express app is exported from index.ts for Vite compatibility
