# Phase 2: Local-First Data Processing & Federated Learning

## Overview
Implement on-device machine learning using browser-based frameworks (TensorFlow.js/ONNX Runtime) and establish federated learning architecture to train models while preserving user privacy.

## Prerequisites
- Phase 1 completed (Chrome extension foundation)
- Understanding of ML inference in browsers
- Knowledge of federated learning concepts
- Familiarity with TensorFlow.js or ONNX Runtime

## Step 1: Set Up Browser-Based ML Framework

### Objective
Configure and integrate a browser-based ML runtime for local inference.

### Actions
1. **Choose and Install ML Framework**:
   - **Option A: TensorFlow.js**
     ```bash
     npm install @tensorflow/tfjs @tensorflow/tfjs-backend-webgl
     ```
   - **Option B: ONNX Runtime Web**
     ```bash
     npm install onnxruntime-web
     ```
   - Recommended: Use ONNX Runtime for better performance and WebGPU support

2. **Configure ML Runtime in Extension**:
   - Add framework to manifest permissions (if needed for WASM)
   - Create ML inference module `/src/ml/inference.js`:
     ```javascript
     import * as ort from 'onnxruntime-web';
     
     export class LocalInference {
       async loadModel(modelPath) {
         this.session = await ort.InferenceSession.create(modelPath, {
           executionProviders: ['webgl', 'wasm']
         });
       }
       
       async predict(inputData) {
         const tensor = new ort.Tensor('float32', inputData, [1, inputData.length]);
         const results = await this.session.run({ input: tensor });
         return results;
       }
     }
     ```

3. **Optimize for Browser Environment**:
   - Enable WebGL/WebGPU for GPU acceleration
   - Configure WebAssembly backend for CPU fallback
   - Set memory limits to prevent browser crashes
   - Implement model caching strategy

4. **Create Model Storage System**:
   - Store models in extension assets or download on install
   - Implement model versioning
   - Add model integrity verification (checksum validation)
   - Create model update mechanism

### Expected Outcome
- Functional ML framework integrated into extension
- Model loading and inference working in browser
- GPU acceleration configured
- Model management system in place

---

## Step 2: Implement Local Data Processing Pipeline

### Objective
Create a privacy-preserving data pipeline that processes all user data locally.

### Actions
1. **Set Up Local Database (IndexedDB)**:
   - Create database schema for feature storage:
     ```javascript
     // Database schema
     const schema = {
       stores: {
         pageFeatures: {
           keyPath: 'id',
           indexes: [
             { name: 'timestamp', unique: false },
             { name: 'riskScore', unique: false }
           ]
         },
         modelUpdates: {
           keyPath: 'updateId',
           indexes: [{ name: 'timestamp', unique: false }]
         }
       }
     };
     ```
   - Implement database wrapper with encryption
   - Add CRUD operations for feature vectors

2. **Build Feature Extraction Pipeline**:
   - Extract features from web pages locally:
     - URL features (length, special chars, domain info)
     - Content features (form fields, links, scripts)
     - Visual features (layout patterns, color schemes)
   - Create feature vector format for ML model
   - Implement efficient feature caching

3. **Create Training Data Collection**:
   - Collect user feedback on risk assessments
   - Store labeled examples locally (user-confirmed safe/malicious)
   - Implement privacy-preserving data sampling
   - Add data anonymization layer:
     ```javascript
     function anonymizeFeatures(features) {
       // Remove PII, keep only ML-relevant data
       return {
         urlLength: features.url.length,
         hasLoginForm: features.hasLoginForm,
         // No actual URLs or personal data
       };
     }
     ```

4. **Implement Local Inference Integration**:
   - Connect risk assessment to ML model predictions
   - Use local model for phishing detection
   - Fall back to rule-based detection if model unavailable
   - Log prediction confidence scores

### Expected Outcome
- Encrypted local database for features and training data
- Feature extraction from pages without data leaving device
- User feedback collection system
- Local inference integrated with risk assessment

---

## Step 3: Design Federated Learning Architecture

### Objective
Implement federated learning to collaboratively train models while keeping user data on-device.

### Actions
1. **Create Federated Learning Client**:
   - Implement on-device training using TensorFlow.js:
     ```javascript
     class FederatedClient {
       async trainLocal(model, localData) {
         // Train on local data only
         const trainedModel = await model.fit(localData, {
           epochs: 5,
           batchSize: 32,
           validationSplit: 0.2
         });
         
         // Extract only gradients/weights
         const weights = await trainedModel.getWeights();
         return this.serializeWeights(weights);
       }
       
       async sendGradients(gradients) {
         // Send only model updates, not data
         await this.secureUpload(gradients);
       }
     }
     ```

2. **Implement Differential Privacy**:
   - Add noise to gradients before sending:
     ```javascript
     function addDifferentialPrivacy(gradients, epsilon = 0.1) {
       return gradients.map(g => {
         const noise = generateLaplaceNoise(epsilon);
         return g + noise;
       });
     }
     ```
   - Configure privacy budget (epsilon parameter)
   - Implement gradient clipping to prevent privacy leaks

3. **Build Secure Aggregation Protocol**:
   - Implement client-side gradient computation
   - Add encryption for gradient transmission:
     ```javascript
     async function encryptGradients(gradients, publicKey) {
       const encrypted = await crypto.subtle.encrypt(
         { name: 'RSA-OAEP' },
         publicKey,
         new TextEncoder().encode(JSON.stringify(gradients))
       );
       return encrypted;
     }
     ```
   - Create communication protocol with aggregation server
   - Implement secure gradient upload mechanism

4. **Design Server Communication API**:
   - Create endpoints for federated learning:
     - `POST /api/fl/join` - Join training round
     - `GET /api/fl/model` - Download global model
     - `POST /api/fl/gradients` - Upload encrypted gradients
     - `GET /api/fl/aggregated` - Get updated model after aggregation
   - Implement request signing for authenticity
   - Add rate limiting to prevent abuse

### Expected Outcome
- Federated learning client running in browser
- Differential privacy applied to gradients
- Secure gradient transmission with encryption
- API design for server-side aggregation

---

## Step 4: Implement Periodic Model Updates

### Objective
Create an automated system for periodic local training and global model updates.

### Actions
1. **Create Training Scheduler**:
   - Implement background training scheduler:
     ```javascript
     class TrainingScheduler {
       constructor() {
         this.interval = 24 * 60 * 60 * 1000; // Daily
       }
       
       async start() {
         chrome.alarms.create('federatedTraining', {
           periodInMinutes: 1440 // 24 hours
         });
         
         chrome.alarms.onAlarm.addListener(async (alarm) => {
           if (alarm.name === 'federatedTraining') {
             await this.performTraining();
           }
         });
       }
       
       async performTraining() {
         const localData = await this.getLocalTrainingData();
         if (localData.length >= MIN_SAMPLES) {
           const gradients = await this.trainLocal(localData);
           await this.uploadGradients(gradients);
         }
       }
     }
     ```

2. **Implement Model Version Control**:
   - Track local and global model versions
   - Download updated global model periodically
   - Merge global updates with local adaptations
   - Handle model rollback if performance degrades

3. **Add User Controls for Federated Learning**:
   - Settings UI for FL participation:
     - Enable/disable FL participation
     - Choose update frequency
     - View contribution statistics
   - Privacy dashboard showing:
     - What data stays local (everything)
     - What is sent (only encrypted gradients)
     - Differential privacy guarantees

4. **Create Monitoring and Validation**:
   - Track local model performance metrics
   - Compare against baseline/global model
   - Log training events (without sensitive data)
   - Implement A/B testing for model updates

### Expected Outcome
- Automated periodic training on local data
- Model update mechanism working
- User controls for FL participation
- Performance monitoring system

---

## Verification Checklist

- [ ] ML framework (TensorFlow.js or ONNX) integrated and working
- [ ] Local inference runs successfully on test data
- [ ] IndexedDB stores encrypted features and training samples
- [ ] Feature extraction works without sending data externally
- [ ] Federated client trains on local data only
- [ ] Differential privacy applied to gradients
- [ ] Encrypted gradient upload implemented
- [ ] Model updates download and integrate successfully
- [ ] User can opt-in/opt-out of federated learning
- [ ] No raw user data ever leaves the device

## Privacy Guarantees

**What Stays Local (Never Leaves Device):**
- All browsing data and URLs
- Page content and features
- User feedback and labels
- Raw training data
- Personal information

**What May Be Sent (Privacy-Preserved):**
- Encrypted model gradients only
- Differential privacy noise added
- Aggregated with other users
- No data can be reverse-engineered

## Next Phase
Proceed to Phase 3: On-Screen Content Scanning & Phishing Detection
