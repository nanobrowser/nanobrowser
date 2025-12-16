# Phase 6: Mac (M1/M4) Compatibility & Performance

## Overview
Ensure the extension runs smoothly on Apple Silicon (M1/M4) Macs with optimal performance. Leverage GPU acceleration, optimize for ARM architecture, and validate cross-platform compatibility.

## Prerequisites
- Phase 1-5 completed (full extension built)
- Access to M1/M4 Mac for testing (or CI/CD with Mac runner)
- Understanding of ARM vs x86 architecture differences
- Knowledge of WebGPU and browser performance optimization

## Step 1: Ensure Cross-Platform Library Compatibility

### Objective
Verify all dependencies and build tools work on Apple Silicon without issues.

### Actions
1. **Audit Dependencies for ARM Compatibility**:
   - Check all npm packages:
     ```bash
     # On M1/M4 Mac
     npm install
     ```
   - Review `package.json` for native modules
   - Identify any x86-only dependencies
   - Common issues to check:
     - Node modules with native bindings
     - Binary dependencies (e.g., node-gyp packages)
     - Build tools (webpack, rollup, etc.)

2. **Use Architecture-Agnostic Libraries**:
   - **ML Inference**: TensorFlow.js and ONNX Runtime Web use WebAssembly/WebGPU
     - Both compile to WASM, which is architecture-agnostic
     - No platform-specific code needed
   - **Crypto**: Web Crypto API is built into browser
   - **Storage**: IndexedDB is browser-native
   - **All browser APIs are cross-platform**

3. **Update Build Configuration**:
   - Ensure build scripts work on both platforms:
     ```json
     {
       "scripts": {
         "build": "webpack --mode production",
         "build:watch": "webpack --mode development --watch",
         "test": "jest",
         "lint": "eslint src/**/*.js"
       }
     }
     ```
   - Test build process on Mac:
     ```bash
     npm run build
     # Verify dist/ folder contains extension files
     ```

4. **Handle Node.js Native Modules** (if any):
   - If using Node for build/training only (not in extension):
     ```bash
     # Install ARM-compatible Node.js
     # Use Node 18+ which has native ARM support
     node --version  # Should show arm64
     
     # Rebuild native modules for ARM
     npm rebuild
     ```
   - Alternatively, use Rosetta 2 for x86 compatibility:
     ```bash
     arch -x86_64 npm install
     ```

### Expected Outcome
- All dependencies install successfully on M1/M4 Mac
- Build process completes without errors
- No architecture-specific code in extension
- Build artifacts identical across platforms

---

## Step 2: Enable GPU Acceleration with WebGPU

### Objective
Leverage Mac's GPU (Apple Silicon or AMD) for faster ML inference using WebGPU.

### Actions
1. **Enable WebGPU in Chrome**:
   - Ensure Chrome version supports WebGPU (Chrome 113+)
   - Check WebGPU availability:
     ```javascript
     async function checkWebGPUSupport() {
       if (!navigator.gpu) {
         console.warn('WebGPU not supported');
         return false;
       }
       
       try {
         const adapter = await navigator.gpu.requestAdapter();
         if (!adapter) {
           console.warn('No WebGPU adapter found');
           return false;
         }
         
         const device = await adapter.requestDevice();
         console.log('WebGPU available:', {
           vendor: adapter.info?.vendor,
           architecture: adapter.info?.architecture,
           features: Array.from(device.features)
         });
         
         return true;
       } catch (error) {
         console.error('WebGPU error:', error);
         return false;
       }
     }
     ```

2. **Configure ONNX Runtime to Use WebGPU**:
   - Update inference configuration:
     ```javascript
     import * as ort from 'onnxruntime-web';
     
     export class GPUInference {
       async loadModel(modelPath) {
         // Try WebGPU first, fall back to WebGL/WASM
         const executionProviders = [
           'webgpu',  // Best performance on modern GPUs
           'webgl',   // Fallback for broader compatibility
           'wasm'     // CPU fallback
         ];
         
         try {
           this.session = await ort.InferenceSession.create(modelPath, {
             executionProviders: executionProviders
           });
           
           console.log('Model loaded with:', this.session.executionProviders);
         } catch (error) {
           console.error('Model loading failed:', error);
           // Try without WebGPU
           this.session = await ort.InferenceSession.create(modelPath, {
             executionProviders: ['wasm']
           });
         }
       }
       
       async predict(inputData) {
         const tensor = new ort.Tensor('float32', inputData, [1, inputData.length]);
         const results = await this.session.run({ input: tensor });
         return results;
       }
     }
     ```

3. **Optimize Model for GPU**:
   - Use FP16 (half-precision) for faster inference:
     ```python
     # In training script
     import onnx
     from onnxmltools.utils.float16_converter import convert_float_to_float16
     
     # Load FP32 model
     model = onnx.load('phishing-detector.onnx')
     
     # Convert to FP16
     model_fp16 = convert_float_to_float16(model)
     
     # Save
     onnx.save(model_fp16, 'phishing-detector-fp16.onnx')
     ```
   
   - Use GPU-optimized operations
   - Batch inference when possible

4. **Benchmark GPU vs CPU Performance**:
   - Create benchmark script:
     ```javascript
     async function benchmarkInference() {
       const testFeatures = generateRandomFeatures(100);
       
       // Test WebGPU
       const gpuInference = new GPUInference();
       await gpuInference.loadModel('/models/phishing-detector.onnx');
       
       const gpuStart = performance.now();
       for (const features of testFeatures) {
         await gpuInference.predict(features);
       }
       const gpuTime = performance.now() - gpuStart;
       
       // Test WASM (CPU)
       const cpuInference = new GPUInference();
       await cpuInference.loadModel('/models/phishing-detector.onnx');
       cpuInference.session.executionProviders = ['wasm'];
       
       const cpuStart = performance.now();
       for (const features of testFeatures) {
         await cpuInference.predict(features);
       }
       const cpuTime = performance.now() - cpuStart;
       
       console.log('GPU Time:', gpuTime, 'ms');
       console.log('CPU Time:', cpuTime, 'ms');
       console.log('Speedup:', (cpuTime / gpuTime).toFixed(2) + 'x');
     }
     ```

### Expected Outcome
- WebGPU enabled on M1/M4 Macs
- ONNX Runtime using GPU for inference
- 2-5x speedup compared to CPU inference
- Graceful fallback to WebGL/WASM if WebGPU unavailable

---

## Step 3: Optimize Performance for Mac

### Objective
Profile and optimize the extension for minimal resource usage on Mac.

### Actions
1. **Profile Extension Performance**:
   - Use Chrome DevTools on Mac:
     ```
     1. Open extension popup/background page
     2. Open DevTools (Cmd+Option+I)
     3. Go to Performance tab
     4. Record while analyzing pages
     5. Analyze CPU, memory, GPU usage
     ```
   
   - Identify bottlenecks:
     - DOM parsing time
     - ML inference time
     - IndexedDB operations
     - Message passing overhead

2. **Optimize DOM Analysis**:
   - Use requestIdleCallback for non-urgent work:
     ```javascript
     class OptimizedDOMAnalyzer {
       async extractFeatures() {
         // Extract critical features immediately
         const urgentFeatures = this.extractUrgentFeatures();
         
         // Defer non-critical analysis
         const deferredFeatures = await this.deferWork(() => 
           this.extractDetailedFeatures()
         );
         
         return { ...urgentFeatures, ...deferredFeatures };
       }
       
       deferWork(callback) {
         return new Promise(resolve => {
           requestIdleCallback(() => {
             const result = callback();
             resolve(result);
           }, { timeout: 1000 });
         });
       }
     }
     ```

3. **Optimize Memory Usage**:
   - Limit cache sizes:
     ```javascript
     class MemoryOptimizedCache {
       constructor(maxEntries = 1000) {
         this.cache = new Map();
         this.maxEntries = maxEntries;
       }
       
       set(key, value) {
         if (this.cache.size >= this.maxEntries) {
           // Remove oldest entry
           const firstKey = this.cache.keys().next().value;
           this.cache.delete(firstKey);
         }
         this.cache.set(key, value);
       }
       
       get(key) {
         return this.cache.get(key);
       }
     }
     ```
   
   - Cleanup unused resources:
     ```javascript
     // Clear old log entries periodically
     async function cleanupOldLogs() {
       const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
       const db = await openDatabase();
       const tx = db.transaction('auditLog', 'readwrite');
       const store = tx.objectStore('auditLog');
       const index = store.index('timestamp');
       
       const range = IDBKeyRange.upperBound(thirtyDaysAgo);
       let cursor = await index.openCursor(range);
       
       while (cursor) {
         cursor.delete();
         cursor = await cursor.continue();
       }
     }
     ```

4. **Reduce Bundle Size**:
   - Enable code splitting:
     ```javascript
     // webpack.config.js
     module.exports = {
       optimization: {
         splitChunks: {
           chunks: 'all',
           cacheGroups: {
             vendor: {
               test: /[\\/]node_modules[\\/]/,
               name: 'vendors',
               priority: 10
             }
           }
         }
       }
     };
     ```
   
   - Tree-shake unused code
   - Compress models and assets

5. **Monitor Resource Usage**:
   - Create performance dashboard:
     ```javascript
     class PerformanceMonitor {
       constructor() {
         this.metrics = {
           avgAnalysisTime: 0,
           memoryUsage: 0,
           cacheHitRate: 0
         };
       }
       
       recordAnalysis(duration) {
         this.metrics.avgAnalysisTime = 
           (this.metrics.avgAnalysisTime * 0.9) + (duration * 0.1);
       }
       
       getMemoryUsage() {
         if (performance.memory) {
           return {
             used: performance.memory.usedJSHeapSize / 1048576, // MB
             total: performance.memory.totalJSHeapSize / 1048576
           };
         }
         return null;
       }
       
       displayMetrics() {
         console.log('Performance Metrics:', {
           avgAnalysisTime: this.metrics.avgAnalysisTime.toFixed(2) + 'ms',
           memoryUsed: this.getMemoryUsage()?.used.toFixed(2) + 'MB'
         });
       }
     }
     ```

### Expected Outcome
- Average page analysis < 50ms on M1/M4
- Memory usage < 100MB under normal operation
- No memory leaks over extended use
- Smooth performance with 50+ tabs open
- Extension doesn't slow down browsing

---

## Step 4: Comprehensive Cross-Platform Testing

### Objective
Validate the extension works identically on Mac (Intel & ARM) and Windows.

### Actions
1. **Set Up Mac Test Environment**:
   - **M1/M4 Mac**:
     ```bash
     # Install dependencies
     npm install
     
     # Build extension
     npm run build
     
     # Open Chrome
     # Navigate to chrome://extensions
     # Enable Developer Mode
     # Click "Load unpacked"
     # Select dist/ folder
     ```
   
   - **Intel Mac** (if available for comparison):
     - Same installation process
     - Compare performance metrics

2. **Create Cross-Platform Test Suite**:
   - Test on multiple platforms:
     ```javascript
     // tests/cross-platform/compatibility.test.js
     describe('Cross-Platform Compatibility', () => {
       test('WebAssembly loads on all platforms', async () => {
         const wasmSupported = typeof WebAssembly !== 'undefined';
         expect(wasmSupported).toBe(true);
       });
       
       test('IndexedDB works on all platforms', async () => {
         const db = await openDatabase();
         expect(db).toBeDefined();
       });
       
       test('Web Crypto API available', () => {
         expect(crypto.subtle).toBeDefined();
       });
       
       test('ML model loads and runs', async () => {
         const inference = new GPUInference();
         await inference.loadModel('/models/phishing-detector.onnx');
         
         const testInput = new Array(30).fill(0.5);
         const result = await inference.predict(testInput);
         
         expect(result).toBeDefined();
       });
     });
     ```

3. **Performance Comparison Tests**:
   - Run benchmarks on each platform:
     ```bash
     # On Mac M1/M4
     npm run benchmark > results-mac-arm.txt
     
     # On Mac Intel
     npm run benchmark > results-mac-intel.txt
     
     # On Windows
     npm run benchmark > results-windows.txt
     ```
   
   - Compare results:
     | Metric | Mac M1 | Mac Intel | Windows |
     |--------|--------|-----------|---------|
     | Avg Analysis Time | <50ms | <60ms | <60ms |
     | GPU Inference | <10ms | <15ms | <15ms |
     | Memory Usage | <80MB | <90MB | <90MB |

4. **Test All Features on Mac**:
   - [ ] Extension loads without errors
   - [ ] Content scripts inject correctly
   - [ ] DOM analysis extracts features
   - [ ] ML model runs inference
   - [ ] Risk warnings display correctly
   - [ ] Tamper-evident logging works
   - [ ] Federated learning client trains locally
   - [ ] Blockchain anchoring (if enabled)
   - [ ] Audit log viewer displays data
   - [ ] All UI components render properly
   - [ ] Keyboard shortcuts work (Cmd vs Ctrl)
   - [ ] Popup opens and functions correctly

5. **Automated CI/CD for Mac**:
   - Use GitHub Actions with Mac runner:
     ```yaml
     # .github/workflows/test.yml
     name: Cross-Platform Tests
     
     on: [push, pull_request]
     
     jobs:
       test-mac:
         runs-on: macos-latest
         steps:
           - uses: actions/checkout@v3
           - uses: actions/setup-node@v3
             with:
               node-version: 18
           - run: npm install
           - run: npm test
           - run: npm run build
           - run: npm run benchmark
       
       test-windows:
         runs-on: windows-latest
         steps:
           - uses: actions/checkout@v3
           - uses: actions/setup-node@v3
             with:
               node-version: 18
           - run: npm install
           - run: npm test
           - run: npm run build
     ```

6. **Fix Platform-Specific Issues**:
   - Common issues to check:
     - **Path separators**: Use `path.join()` instead of hardcoded `/` or `\`
     - **File permissions**: Mac may have stricter permissions
     - **Case sensitivity**: macOS filesystem can be case-sensitive
     - **Keyboard shortcuts**: Cmd (Mac) vs Ctrl (Windows)
   
   - Handle keyboard shortcuts:
     ```javascript
     const isMac = navigator.platform.toLowerCase().includes('mac');
     const modifierKey = isMac ? 'Cmd' : 'Ctrl';
     
     chrome.commands.onCommand.addListener((command) => {
       if (command === 'open-audit-log') {
         // Works with Cmd+Shift+L on Mac, Ctrl+Shift+L on Windows
         openAuditLog();
       }
     });
     ```

### Expected Outcome
- Extension works identically on Mac M1, Mac Intel, and Windows
- All tests pass on all platforms
- Performance within expected ranges
- No platform-specific bugs
- CI/CD validates every commit on Mac

---

## Verification Checklist

- [ ] All dependencies install on M1/M4 Mac
- [ ] Build process completes successfully on Mac
- [ ] WebGPU enabled and working
- [ ] GPU acceleration provides 2-5x speedup
- [ ] Average analysis time < 50ms on Mac
- [ ] Memory usage < 100MB
- [ ] Extension loads in Chrome on Mac
- [ ] All features work on Mac (phishing detection, logging, etc.)
- [ ] No performance degradation with 50+ tabs
- [ ] Cross-platform tests pass on Mac and Windows
- [ ] CI/CD includes Mac runner
- [ ] No platform-specific bugs found
- [ ] User experience identical across platforms

## Performance Targets

| Metric | Target | Mac M1 Actual | Status |
|--------|--------|---------------|--------|
| Page Analysis Time | < 50ms | ___ms | ⏳ |
| ML Inference Time | < 10ms | ___ms | ⏳ |
| Memory Usage | < 100MB | ___MB | ⏳ |
| Extension Load Time | < 200ms | ___ms | ⏳ |
| GPU Utilization | > 50% | __% | ⏳ |

## Final Testing Procedure

1. **Clean Install on Mac M1/M4**:
   ```bash
   # Clone repo
   git clone <repo-url>
   cd nanobrowser
   
   # Install and build
   npm install
   npm run build
   
   # Load in Chrome
   # Chrome > Extensions > Load unpacked > Select dist/
   ```

2. **Run Full Test Suite**:
   ```bash
   npm test
   npm run test:e2e
   npm run benchmark
   ```

3. **Manual Testing**:
   - Visit 10 legitimate sites → No false positives
   - Visit 10 known phishing sites → All detected
   - Open 50+ tabs → Performance acceptable
   - Use for 1 hour → No memory leaks

4. **Verify GPU Acceleration**:
   - Check Chrome task manager (Window > Task Manager)
   - Verify GPU process active during analysis

## Deployment

Once all phases complete:
- [ ] Package extension for Chrome Web Store
- [ ] Create privacy policy documentation
- [ ] Write user guide for Mac users
- [ ] Submit for Chrome Web Store review
- [ ] Publish open-source code to GitHub

---

🎉 **Congratulations!** All 6 phases complete. You now have a fully functional, secure, agentic browser extension with local ML, federated learning, tamper-evident logging, and full Mac compatibility!
