# Phase 3: On-Screen Content Scanning & Phishing Detection

## Overview
Build a comprehensive content analysis engine that inspects all visible content in the browser using content scripts, DOM analysis, and optional visual scanning. Integrate ML-based phishing detection with real-time warnings.

## Prerequisites
- Phase 1 & 2 completed (foundation and local ML)
- Understanding of Chrome content scripts and DOM manipulation
- Knowledge of phishing detection techniques
- ML model trained for phishing detection (from Phase 5, or use pre-trained)

## Step 1: Implement Content Script Injection and DOM Analysis

### Objective
Create content scripts that extract features from web pages for phishing analysis.

### Actions
1. **Configure Content Script Injection**:
   - Update `manifest.json` to inject content scripts:
     ```json
     {
       "content_scripts": [{
         "matches": ["<all_urls>"],
         "js": ["content/scanner.js", "content/dom-analyzer.js"],
         "run_at": "document_idle",
         "all_frames": false
       }]
     }
     ```
   - Add dynamic injection for specific cases
   - Handle frame isolation and security contexts

2. **Build DOM Feature Extractor**:
   - Create `/src/content/dom-analyzer.js`:
     ```javascript
     class DOMAnalyzer {
       extractFeatures() {
         return {
           // URL features
           url: window.location.href,
           urlLength: window.location.href.length,
           domain: window.location.hostname,
           hasSubdomain: this.countSubdomains(),
           usesHTTPS: window.location.protocol === 'https:',
           
           // Form features
           loginForms: this.detectLoginForms(),
           formCount: document.querySelectorAll('form').length,
           inputFields: document.querySelectorAll('input').length,
           passwordFields: document.querySelectorAll('input[type="password"]').length,
           
           // Link features
           externalLinks: this.countExternalLinks(),
           suspiciousLinks: this.detectSuspiciousLinks(),
           
           // Content features
           iframes: document.querySelectorAll('iframe').length,
           hiddenElements: this.countHiddenElements(),
           scriptTags: document.querySelectorAll('script').length,
           
           // Visual indicators
           faviconPresent: !!document.querySelector('link[rel*="icon"]'),
           hasSSLIndicator: this.checkSSLIndicators(),
         };
       }
       
       detectLoginForms() {
         const forms = document.querySelectorAll('form');
         return Array.from(forms).filter(form => {
           const inputs = form.querySelectorAll('input[type="password"]');
           return inputs.length > 0;
         }).length;
       }
       
       detectSuspiciousLinks() {
         const links = document.querySelectorAll('a');
         let suspiciousCount = 0;
         links.forEach(link => {
           const href = link.href;
           const text = link.textContent;
           // Check for mismatched domains
           if (this.isMismatchedLink(href, text)) suspiciousCount++;
           // Check for IP addresses
           if (/\d+\.\d+\.\d+\.\d+/.test(href)) suspiciousCount++;
         });
         return suspiciousCount;
       }
     }
     ```

3. **Implement URL Analysis**:
   - Extract URL-based features:
     - Domain length and special characters
     - Presence of suspicious keywords (login, security, verify, etc.)
     - Homograph attack detection (lookalike characters)
     - URL shortener detection
   - Check against allowlist/blocklist
   - Perform WHOIS lookup (via background script with API)

4. **Create Communication Channel**:
   - Set up message passing between content script and background:
     ```javascript
     // In content script
     const features = domAnalyzer.extractFeatures();
     chrome.runtime.sendMessage({
       type: 'ANALYZE_PAGE',
       features: features,
       timestamp: Date.now()
     });
     
     // Listen for results
     chrome.runtime.onMessage.addListener((message) => {
       if (message.type === 'RISK_ASSESSMENT') {
         this.handleRiskResult(message.riskScore, message.reasons);
       }
     });
     ```

### Expected Outcome
- Content scripts injected on all pages
- Comprehensive DOM feature extraction
- URL analysis and suspicious pattern detection
- Secure communication with background script

---

## Step 2: Implement Visual Page Capture and OCR (Optional)

### Objective
Add visual analysis capability for detecting visually-spoofed phishing pages.

### Actions
1. **Add Tab Capture Permission**:
   - Update `manifest.json`:
     ```json
     {
       "permissions": ["activeTab", "tabCapture"],
       "host_permissions": ["<all_urls>"]
     }
     ```

2. **Implement Page Screenshot Capture**:
   - Create `/src/background/screenshot-capture.js`:
     ```javascript
     class ScreenshotCapture {
       async captureVisibleTab(tabId) {
         try {
           const dataUrl = await chrome.tabs.captureVisibleTab(null, {
             format: 'png',
             quality: 90
           });
           return dataUrl;
         } catch (error) {
           console.error('Screenshot capture failed:', error);
           return null;
         }
       }
       
       async analyzeImage(imageData) {
         // Convert to features for ML analysis
         const features = await this.extractVisualFeatures(imageData);
         return features;
       }
     }
     ```

3. **Add OCR for Text Extraction (Optional)**:
   - Integrate Tesseract.js for in-browser OCR:
     ```bash
     npm install tesseract.js
     ```
   - Extract text from screenshots:
     ```javascript
     import Tesseract from 'tesseract.js';
     
     async function extractTextFromImage(imageData) {
       const { data: { text } } = await Tesseract.recognize(imageData, 'eng');
       return text;
     }
     ```
   - Analyze extracted text for phishing keywords

4. **Visual Similarity Detection**:
   - Compare page layouts with known legitimate sites
   - Detect logo spoofing
   - Identify color scheme mimicry
   - Use perceptual hashing for similarity matching

### Expected Outcome
- Screenshot capture working for suspicious pages
- Optional OCR for text extraction
- Visual feature extraction for ML model
- Detection of visually-spoofed pages

---

## Step 3: Integrate ML-Based Phishing Detection

### Objective
Connect feature extraction to ML model and generate real-time risk scores.

### Actions
1. **Create Phishing Detection Service**:
   - Build `/src/background/phishing-detector.js`:
     ```javascript
     import { LocalInference } from '../ml/inference.js';
     
     class PhishingDetector {
       constructor() {
         this.model = new LocalInference();
         this.loadModel();
       }
       
       async loadModel() {
         await this.model.loadModel('/models/phishing-detector.onnx');
       }
       
       async detectPhishing(features) {
         // Normalize features
         const normalizedFeatures = this.normalizeFeatures(features);
         
         // Run ML inference
         const prediction = await this.model.predict(normalizedFeatures);
         
         // Combine with rule-based detection
         const mlScore = prediction.score;
         const ruleScore = this.ruleBasedDetection(features);
         
         // Weighted combination
         const finalScore = (mlScore * 0.7) + (ruleScore * 0.3);
         
         return {
           riskScore: finalScore,
           confidence: prediction.confidence,
           reasons: this.explainPrediction(features, mlScore, ruleScore),
           mlPrediction: mlScore,
           rulePrediction: ruleScore
         };
       }
       
       ruleBasedDetection(features) {
         let score = 0;
         
         // URL-based rules
         if (features.urlLength > 75) score += 10;
         if (!features.usesHTTPS) score += 20;
         if (features.hasSubdomain > 3) score += 15;
         
         // Content-based rules
         if (features.loginForms > 0 && !features.usesHTTPS) score += 30;
         if (features.suspiciousLinks > 5) score += 20;
         if (features.iframes > 3) score += 10;
         if (features.hiddenElements > 10) score += 15;
         
         return Math.min(score, 100);
       }
       
       explainPrediction(features, mlScore, ruleScore) {
         const reasons = [];
         if (!features.usesHTTPS) reasons.push('No HTTPS encryption');
         if (features.suspiciousLinks > 0) reasons.push(`${features.suspiciousLinks} suspicious links detected`);
         if (features.loginForms > 0 && !features.usesHTTPS) reasons.push('Login form on non-HTTPS page');
         // Add more explanations
         return reasons;
       }
     }
     ```

2. **Implement Feature Normalization**:
   - Normalize numeric features to 0-1 range
   - One-hot encode categorical features
   - Handle missing features gracefully

3. **Create Fallback Detection**:
   - If ML model fails, use rule-based detection
   - Combine multiple detection methods
   - Implement weighted scoring system

4. **Add Explainability**:
   - Generate human-readable reasons for risk scores
   - Highlight which features triggered detection
   - Provide actionable recommendations

### Expected Outcome
- ML model integrated for phishing detection
- Real-time risk scoring for all pages
- Hybrid ML + rule-based approach
- Explainable predictions with reasons

---

## Step 4: Implement User Warnings and Response System

### Objective
Create an effective warning system that alerts users to phishing risks and allows informed decisions.

### Actions
1. **Design Warning UI Overlay**:
   - Create `/src/content/warning-overlay.js`:
     ```javascript
     class WarningOverlay {
       show(riskScore, reasons) {
         // Create overlay
         const overlay = document.createElement('div');
         overlay.id = 'phishing-warning-overlay';
         overlay.innerHTML = `
           <div class="warning-content">
             <div class="warning-header">
               <img src="${chrome.runtime.getURL('assets/warning-icon.png')}" />
               <h2>⚠️ Security Warning</h2>
             </div>
             <div class="warning-body">
               <p><strong>Risk Score: ${riskScore}/100</strong></p>
               <p>This page may be attempting to steal your information:</p>
               <ul>
                 ${reasons.map(r => `<li>${r}</li>`).join('')}
               </ul>
             </div>
             <div class="warning-actions">
               <button id="go-back-btn" class="primary">Go Back (Recommended)</button>
               <button id="proceed-anyway-btn" class="secondary">Proceed Anyway</button>
               <button id="report-btn" class="tertiary">Report This Page</button>
             </div>
           </div>
         `;
         
         // Style overlay
         overlay.style.cssText = `
           position: fixed; top: 0; left: 0; width: 100%; height: 100%;
           background: rgba(0,0,0,0.95); z-index: 2147483647;
           display: flex; align-items: center; justify-content: center;
         `;
         
         document.body.appendChild(overlay);
         this.attachEventListeners();
       }
       
       attachEventListeners() {
         document.getElementById('go-back-btn').addEventListener('click', () => {
           window.history.back();
         });
         
         document.getElementById('proceed-anyway-btn').addEventListener('click', () => {
           this.requireConfirmation(() => {
             document.getElementById('phishing-warning-overlay').remove();
           });
         });
       }
       
       requireConfirmation(callback) {
         const confirmed = confirm(
           'Are you sure? This page has been flagged as potentially dangerous. ' +
           'Proceeding may put your personal information at risk.'
         );
         if (confirmed) callback();
       }
     }
     ```

2. **Implement Risk-Based Actions**:
   - **Low Risk (0-30)**: Silent logging, no user disruption
   - **Medium Risk (31-70)**: Warning banner at top of page
   - **High Risk (71-100)**: Full-screen blocking overlay
   - Allow user override with confirmation for medium/high risk

3. **Create Logging System**:
   - Log all risk assessments:
     ```javascript
     async function logRiskAssessment(url, riskScore, features, userAction) {
       const logEntry = {
         timestamp: Date.now(),
         url: hashURL(url), // Hash for privacy
         riskScore: riskScore,
         features: sanitizeFeatures(features),
         userAction: userAction, // 'blocked', 'proceeded', 'went-back'
         modelVersion: MODEL_VERSION
       };
       
       await saveToTamperEvidentLog(logEntry);
       
       // Use for federated learning
       if (userAction === 'went-back') {
         // Confirmed phishing
         await addToTrainingData(features, label: 'phishing');
       }
     }
     ```

4. **Add User Feedback Mechanism**:
   - Allow users to report false positives/negatives
   - Collect feedback for model improvement
   - Integrate with federated learning pipeline

5. **Create Notification System**:
   - Browser notifications for blocked pages
   - Badge count on extension icon
   - Summary reports in popup UI

### Expected Outcome
- Warning overlays display for risky pages
- Risk-based blocking/warning system
- User override with confirmation
- Comprehensive logging of all detections
- User feedback collection for model improvement

---

## Verification Checklist

- [ ] Content scripts inject and extract features correctly
- [ ] DOM analysis captures all relevant phishing indicators
- [ ] URL analysis detects suspicious patterns
- [ ] Screenshot capture works (if implemented)
- [ ] ML model runs inference on extracted features
- [ ] Risk scores calculated accurately
- [ ] Warning overlays display correctly
- [ ] User can go back from high-risk pages
- [ ] User can override warnings with confirmation
- [ ] All detections logged to tamper-evident log
- [ ] Tested on known phishing URLs (from PhishTank)
- [ ] Tested on legitimate sites (no false positives)
- [ ] Performance acceptable (< 100ms analysis time)

## Testing Resources

**Phishing Test Sites:**
- PhishTank recent phishing URLs: https://phishtank.org/
- OpenPhish feed: https://openphish.com/
- Create test HTML pages with phishing patterns

**Legitimate Test Sites:**
- Major banks: chase.com, bankofamerica.com
- Tech companies: google.com, microsoft.com, apple.com
- E-commerce: amazon.com, ebay.com

**Performance Testing:**
- Test on complex pages (e.g., CNN, Reddit)
- Measure feature extraction time
- Monitor memory usage
- Test with 50+ tabs open

## Next Phase
Proceed to Phase 4: Tamper-Evident Logging (Blockchain Option)
