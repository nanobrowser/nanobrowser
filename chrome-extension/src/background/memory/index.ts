/**
 * Procedural Memory Module
 * Implements MEMP (Memory-Enhanced Multi-Agent Planning) framework
 *
 * This module provides:
 * 1. BUILD: Record human demonstrations and distill into procedural memory ✅
 * 2. RETRIEVE: Find relevant memories for current tasks ✅
 * 3. UPDATE: Refine memories based on execution outcomes (to be implemented)
 */

export * from './types';
export * from './recorder';
export * from './builder';
export * from './retriever';
