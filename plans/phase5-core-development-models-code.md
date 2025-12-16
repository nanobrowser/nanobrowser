# Phase 5: Core Development (Models & Code from Scratch)

## Overview
Develop custom machine learning models and core codebase from scratch without relying on third-party agents. Train phishing detection models, implement secure coding practices, and build comprehensive testing infrastructure.

## Prerequisites
- Phase 1-4 completed (foundation, ML infrastructure, detection, logging)
- Python/JavaScript development environment
- Understanding of machine learning (Random Forest, SVMs, Neural Networks)
- Knowledge of secure coding practices

## Step 1: Gather Training Data and Train ML Models

### Objective
Collect legitimate and phishing datasets, extract features, and train custom classification models.

### Actions
1. **Collect Training Datasets**:
   - **Phishing URLs**:
     - PhishTank: https://phishtank.org/developer_info.php
       - Download recent verified phishing URLs (JSON/CSV format)
       - ~50,000+ confirmed phishing URLs
     - OpenPhish: https://openphish.com/feed.txt
       - Real-time phishing feed
     - URLhaus: https://urlhaus.abuse.ch/
       - Malware and phishing URL database
   
   - **Legitimate URLs**:
     - Alexa Top 1M sites (or similar ranking)
     - Common login pages (banks, social media, e-commerce)
     - Government and educational domains (.gov, .edu)
   
   - **Create dataset script** `/training/collect_data.py`:
     ```python
     import pandas as pd
     import requests
     from urllib.parse import urlparse
     
     class DatasetCollector:
         def __init__(self):
             self.phishing_urls = []
             self.legitimate_urls = []
         
         def fetch_phishtank(self, api_key):
             """Fetch from PhishTank API"""
             url = f"http://data.phishtank.com/data/{api_key}/online-valid.json"
             response = requests.get(url)
             data = response.json()
             
             self.phishing_urls.extend([
                 entry['url'] for entry in data
             ])
         
         def fetch_alexa_top(self, count=10000):
             """Fetch legitimate domains from Alexa/Tranco"""
             # Use Tranco list (free alternative to Alexa)
             response = requests.get('https://tranco-list.eu/top-1m.csv.zip')
             # Extract and process
             # Add to self.legitimate_urls
         
         def create_dataset(self):
             """Create labeled dataset"""
             data = []
             
             for url in self.phishing_urls:
                 data.append({'url': url, 'label': 1})  # Phishing
             
             for url in self.legitimate_urls:
                 data.append({'url': url, 'label': 0})  # Legitimate
             
             df = pd.DataFrame(data)
             df.to_csv('training_dataset.csv', index=False)
             return df
     ```

2. **Extract Features from URLs and Content**:
   - Create `/training/feature_extraction.py`:
     ```python
     import re
     from urllib.parse import urlparse
     import tldextract
     
     class FeatureExtractor:
         def extract_url_features(self, url):
             """Extract 30+ features from URL"""
             parsed = urlparse(url)
             extracted = tldextract.extract(url)
             
             features = {
                 # Length features
                 'url_length': len(url),
                 'domain_length': len(parsed.netloc),
                 'path_length': len(parsed.path),
                 
                 # Character features
                 'num_dots': url.count('.'),
                 'num_hyphens': url.count('-'),
                 'num_underscores': url.count('_'),
                 'num_slashes': url.count('/'),
                 'num_question': url.count('?'),
                 'num_equal': url.count('='),
                 'num_at': url.count('@'),
                 'num_ampersand': url.count('&'),
                 
                 # Domain features
                 'subdomain_count': len(extracted.subdomain.split('.')) if extracted.subdomain else 0,
                 'has_ip_address': bool(re.match(r'\d+\.\d+\.\d+\.\d+', parsed.netloc)),
                 
                 # Protocol features
                 'is_https': parsed.scheme == 'https',
                 'has_port': bool(re.search(r':\d+', parsed.netloc)),
                 
                 # Suspicious patterns
                 'has_login_keyword': bool(re.search(r'(login|signin|account|verify|secure|update)', url, re.I)),
                 'has_phish_keywords': bool(re.search(r'(paypal|ebay|bank|secure)', url, re.I)),
                 'has_suspicious_tld': extracted.suffix in ['tk', 'ml', 'ga', 'cf', 'gq'],
                 
                 # Encoding features
                 'percent_encoded': url.count('%'),
                 'has_double_slash_redirect': bool(re.search(r'http[s]?://.*//', url)),
                 
                 # Reputation features (placeholder)
                 'domain_age_days': 0,  # Would need WHOIS lookup
                 'alexa_rank': 0,  # Would need Alexa/Tranco API
             }
             
             return features
         
         def extract_content_features(self, html_content):
             """Extract features from page content"""
             from bs4 import BeautifulSoup
             soup = BeautifulSoup(html_content, 'html.parser')
             
             features = {
                 'form_count': len(soup.find_all('form')),
                 'input_count': len(soup.find_all('input')),
                 'password_fields': len(soup.find_all('input', {'type': 'password'})),
                 'external_links': self.count_external_links(soup),
                 'iframe_count': len(soup.find_all('iframe')),
                 'script_count': len(soup.find_all('script')),
                 'has_favicon': bool(soup.find('link', rel='icon')),
             }
             
             return features
     ```

3. **Train Classification Models**:
   - Create `/training/train_model.py`:
     ```python
     import pandas as pd
     from sklearn.model_selection import train_test_split
     from sklearn.ensemble import RandomForestClassifier
     from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
     from sklearn.preprocessing import StandardScaler
     import joblib
     
     class PhishingModelTrainer:
         def __init__(self):
             self.model = None
             self.scaler = StandardScaler()
         
         def prepare_data(self, csv_file):
             """Load and prepare dataset"""
             df = pd.read_csv(csv_file)
             
             # Extract features for all URLs
             extractor = FeatureExtractor()
             features_list = []
             
             for url in df['url']:
                 features = extractor.extract_url_features(url)
                 features_list.append(features)
             
             X = pd.DataFrame(features_list)
             y = df['label']
             
             return train_test_split(X, y, test_size=0.2, random_state=42)
         
         def train_random_forest(self, X_train, y_train):
             """Train Random Forest (based on NoPhish paper)"""
             self.model = RandomForestClassifier(
                 n_estimators=100,
                 max_depth=20,
                 min_samples_split=5,
                 random_state=42,
                 n_jobs=-1
             )
             
             # Scale features
             X_train_scaled = self.scaler.fit_transform(X_train)
             
             # Train
             self.model.fit(X_train_scaled, y_train)
         
         def evaluate(self, X_test, y_test):
             """Evaluate model performance"""
             X_test_scaled = self.scaler.transform(X_test)
             y_pred = self.model.predict(X_test_scaled)
             
             metrics = {
                 'accuracy': accuracy_score(y_test, y_pred),
                 'precision': precision_score(y_test, y_pred),
                 'recall': recall_score(y_test, y_pred),
                 'f1_score': f1_score(y_test, y_pred)
             }
             
             print(f"Accuracy: {metrics['accuracy']:.4f}")
             print(f"Precision: {metrics['precision']:.4f}")
             print(f"Recall: {metrics['recall']:.4f}")
             print(f"F1 Score: {metrics['f1_score']:.4f}")
             
             return metrics
         
         def export_to_onnx(self, output_path):
             """Convert model to ONNX format for browser"""
             from skl2onnx import convert_sklearn
             from skl2onnx.common.data_types import FloatTensorType
             
             # Define input shape
             initial_type = [('float_input', FloatTensorType([None, X_train.shape[1]]))]
             
             # Convert to ONNX
             onnx_model = convert_sklearn(
                 self.model,
                 initial_types=initial_type,
                 target_opset=12
             )
             
             # Save
             with open(output_path, 'wb') as f:
                 f.write(onnx_model.SerializeToString())
             
             print(f"Model exported to {output_path}")
     
     # Training script
     if __name__ == '__main__':
         trainer = PhishingModelTrainer()
         
         # Prepare data
         X_train, X_test, y_train, y_test = trainer.prepare_data('training_dataset.csv')
         
         # Train
         trainer.train_random_forest(X_train, y_train)
         
         # Evaluate
         trainer.evaluate(X_test, y_test)
         
         # Export for browser
         trainer.export_to_onnx('../src/models/phishing-detector.onnx')
     ```

4. **Create Alternative Models** (Optional):
   - Train SVM, Gradient Boosting, or lightweight neural network
   - Compare performance and size
   - Choose best model for browser deployment

### Expected Outcome
- Training dataset with 50k+ labeled examples
- Feature extraction pipeline implemented
- Random Forest model trained with >95% accuracy
- Model exported to ONNX format for browser use
- Evaluation metrics documented

---

## Step 2: Implement Secure Coding Practices

### Objective
Write robust, secure code following Chrome extension security best practices.

### Actions
1. **Create Input Validation Utilities**:
   - Build `/src/utils/validation.js`:
     ```javascript
     export class InputValidator {
       static sanitizeHTML(input) {
         const div = document.createElement('div');
         div.textContent = input;
         return div.innerHTML;
       }
       
       static validateURL(url) {
         try {
           const parsed = new URL(url);
           // Only allow http/https
           if (!['http:', 'https:'].includes(parsed.protocol)) {
             return false;
           }
           return true;
         } catch {
           return false;
         }
       }
       
       static sanitizeMessage(message) {
         // Validate message structure
         if (typeof message !== 'object') return null;
         
         const allowedTypes = [
           'ANALYZE_PAGE',
           'RISK_ASSESSMENT',
           'LOG_EVENT'
         ];
         
         if (!allowedTypes.includes(message.type)) return null;
         
         // Sanitize all string fields
         for (const key in message) {
           if (typeof message[key] === 'string') {
             message[key] = this.sanitizeHTML(message[key]);
           }
         }
         
         return message;
       }
       
       static validateRiskScore(score) {
         const num = parseFloat(score);
         return !isNaN(num) && num >= 0 && num <= 100;
       }
     }
     ```

2. **Eliminate Unsafe Code Patterns**:
   - **Never use `eval()`**:
     ```javascript
     // BAD - NEVER DO THIS
     eval(userInput);
     
     // GOOD - Use JSON.parse for data
     try {
       const data = JSON.parse(userInput);
     } catch (e) {
       // Handle parse error
     }
     ```
   
   - **Avoid `innerHTML` with untrusted data**:
     ```javascript
     // BAD
     element.innerHTML = untrustedData;
     
     // GOOD
     element.textContent = untrustedData;
     // OR use DOMPurify library
     element.innerHTML = DOMPurify.sanitize(untrustedData);
     ```
   
   - **Use safe Dynamic imports**:
     ```javascript
     // Avoid dynamic require/import with user input
     // Use static imports or whitelist
     const allowedModules = {
       'scanner': () => import('./scanner.js'),
       'analyzer': () => import('./analyzer.js')
     };
     
     if (allowedModules[moduleName]) {
       const module = await allowedModules[moduleName]();
     }
     ```

3. **Implement Secure Communication**:
   - Create `/src/utils/secure-messaging.js`:
     ```javascript
     export class SecureMessaging {
       constructor() {
         this.trustedContexts = [
           chrome.runtime.getURL('')
         ];
       }
       
       isTrustedSender(sender) {
         // Verify sender is from our extension
         if (!sender.id || sender.id !== chrome.runtime.id) {
           return false;
         }
         
         // Verify origin
         if (sender.url && !sender.url.startsWith(chrome.runtime.getURL(''))) {
           return false;
         }
         
         return true;
       }
       
       async sendSecureMessage(message, tabId = null) {
         // Sign message (optional for internal use)
         const signedMessage = {
           ...message,
           timestamp: Date.now(),
           nonce: this.generateNonce()
         };
         
         if (tabId) {
           return chrome.tabs.sendMessage(tabId, signedMessage);
         } else {
           return chrome.runtime.sendMessage(signedMessage);
         }
       }
       
       generateNonce() {
         return Array.from(crypto.getRandomValues(new Uint8Array(16)))
           .map(b => b.toString(16).padStart(2, '0'))
           .join('');
       }
     }
     ```

4. **Create Security Configuration**:
   - Build `/src/config/security.js`:
     ```javascript
     export const SecurityConfig = {
       // CSP settings
       csp: {
         scriptSrc: ["'self'"],
         objectSrc: ["'self'"],
         connectSrc: ["'self'", "https:"],
       },
       
       // Allowed API endpoints
       allowedEndpoints: [
         'https://api.yourserver.com/fl',
         'https://api.yourserver.com/anchor'
       ],
       
       // Rate limiting
       rateLimit: {
         maxRequestsPerMinute: 10,
         maxLogEntriesPerHour: 1000
       },
       
       // Feature flags
       features: {
         screenshotCapture: true,
         federatedLearning: true,
         blockchainAnchoring: false
       }
     };
     ```

### Expected Outcome
- Input validation for all external data
- No use of eval(), innerHTML, or other unsafe patterns
- Secure message passing with sender verification
- Security configuration centralized
- Code follows Chrome extension security guidelines

---

## Step 3: Build Comprehensive Testing Infrastructure

### Objective
Create unit tests, integration tests, and end-to-end tests for all components.

### Actions
1. **Set Up Testing Framework**:
   - Install testing dependencies:
     ```bash
     npm install --save-dev jest @testing-library/dom @testing-library/jest-dom
     npm install --save-dev sinon-chrome  # Mock Chrome APIs
     ```
   
   - Configure Jest `/jest.config.js`:
     ```javascript
     module.exports = {
       testEnvironment: 'jsdom',
       setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
       moduleNameMapper: {
         '^@/(.*)$': '<rootDir>/src/$1'
       },
       collectCoverageFrom: [
         'src/**/*.js',
         '!src/**/*.test.js'
       ],
       coverageThreshold: {
         global: {
           branches: 80,
           functions: 80,
           lines: 80,
           statements: 80
         }
       }
     };
     ```

2. **Write Unit Tests**:
   - Create `/tests/unit/dom-analyzer.test.js`:
     ```javascript
     import { DOMAnalyzer } from '../../src/content/dom-analyzer';
     
     describe('DOMAnalyzer', () => {
       let analyzer;
       
       beforeEach(() => {
         document.body.innerHTML = ''; // Reset
         analyzer = new DOMAnalyzer();
       });
       
       test('should detect login forms', () => {
         document.body.innerHTML = `
           <form>
             <input type="text" name="username" />
             <input type="password" name="password" />
           </form>
         `;
         
         const features = analyzer.extractFeatures();
         expect(features.loginForms).toBe(1);
         expect(features.passwordFields).toBe(1);
       });
       
       test('should count suspicious links', () => {
         document.body.innerHTML = `
           <a href="http://192.168.1.1/login">Link 1</a>
           <a href="http://example.com">Link 2</a>
         `;
         
         const features = analyzer.extractFeatures();
         expect(features.suspiciousLinks).toBeGreaterThan(0);
       });
       
       test('should detect iframes', () => {
         document.body.innerHTML = `
           <iframe src="http://evil.com"></iframe>
           <iframe src="http://malicious.com"></iframe>
         `;
         
         const features = analyzer.extractFeatures();
         expect(features.iframes).toBe(2);
       });
     });
     ```
   
   - Create `/tests/unit/phishing-detector.test.js`:
     ```javascript
     import { PhishingDetector } from '../../src/background/phishing-detector';
     
     describe('PhishingDetector', () => {
       let detector;
       
       beforeEach(async () => {
         detector = new PhishingDetector();
         await detector.loadModel();
       });
       
       test('should flag non-HTTPS login page', async () => {
         const features = {
           usesHTTPS: false,
           loginForms: 1,
           urlLength: 50
         };
         
         const result = await detector.detectPhishing(features);
         expect(result.riskScore).toBeGreaterThan(30);
         expect(result.reasons).toContain('Login form on non-HTTPS page');
       });
       
       test('should pass legitimate HTTPS site', async () => {
         const features = {
           usesHTTPS: true,
           loginForms: 0,
           urlLength: 25,
           suspiciousLinks: 0
         };
         
         const result = await detector.detectPhishing(features);
         expect(result.riskScore).toBeLessThan(30);
       });
     });
     ```

3. **Write Integration Tests**:
   - Create `/tests/integration/detection-flow.test.js`:
     ```javascript
     import chrome from 'sinon-chrome';
     global.chrome = chrome;
     
     describe('Detection Flow Integration', () => {
       test('should analyze page and show warning', async () => {
         // Set up mock page
         document.body.innerHTML = `
           <form>
             <input type="password" />
           </form>
         `;
         
         // Trigger content script
         const scanner = new DOMAnalyzer();
         const features = scanner.extractFeatures();
         
         // Simulate message to background
         const detector = new PhishingDetector();
         const result = await detector.detectPhishing(features);
         
         // Verify warning would be shown
         if (result.riskScore > 70) {
           const overlay = new WarningOverlay();
           overlay.show(result.riskScore, result.reasons);
           
           expect(document.getElementById('phishing-warning-overlay')).toBeTruthy();
         }
       });
     });
     ```

4. **Create End-to-End Tests**:
   - Use Puppeteer for E2E testing:
     ```bash
     npm install --save-dev puppeteer
     ```
   
   - Create `/tests/e2e/extension.test.js`:
     ```javascript
     const puppeteer = require('puppeteer');
     const path = require('path');
     
     describe('Extension E2E Tests', () => {
       let browser, page;
       
       beforeAll(async () => {
         const extensionPath = path.join(__dirname, '../../dist');
         
         browser = await puppeteer.launch({
           headless: false,
           args: [
             `--disable-extensions-except=${extensionPath}`,
             `--load-extension=${extensionPath}`
           ]
         });
         
         page = await browser.newPage();
       });
       
       afterAll(async () => {
         await browser.close();
       });
       
       test('should block known phishing site', async () => {
         // Navigate to test phishing page
         await page.goto('http://localhost:8080/test-phishing.html');
         
         // Wait for warning overlay
         await page.waitForSelector('#phishing-warning-overlay', { timeout: 5000 });
         
         const overlay = await page.$('#phishing-warning-overlay');
         expect(overlay).toBeTruthy();
       });
       
       test('should allow legitimate site', async () => {
         await page.goto('https://example.com');
         
         // Should not show warning
         const overlay = await page.$('#phishing-warning-overlay');
         expect(overlay).toBeFalsy();
       });
     });
     ```

### Expected Outcome
- Jest testing framework configured
- Unit tests for all major components
- Integration tests for detection flow
- E2E tests for extension behavior
- Test coverage >80% for critical code

---

## Step 4: Perform Security Testing and Iteration

### Objective
Test against real phishing attacks, fix bugs, and refine detection algorithms.

### Actions
1. **Create Test Phishing Pages**:
   - Build test server `/tests/fixtures/test-server.js`:
     ```javascript
     const express = require('express');
     const app = express();
     
     // Legitimate page
     app.get('/legitimate', (req, res) => {
       res.send(`
         <html>
           <head><title>Legitimate Site</title></head>
           <body>
             <h1>Welcome to Example Corp</h1>
             <a href="https://example.com">Link</a>
           </body>
         </html>
       `);
     });
     
     // Phishing page - no HTTPS + login form
     app.get('/phishing-login', (req, res) => {
       res.send(`
         <html>
           <head><title>Secure Login</title></head>
           <body>
             <h1>Bank Login</h1>
             <form>
               <input type="text" name="username" />
               <input type="password" name="password" />
               <button>Login</button>
             </form>
           </body>
         </html>
       `);
     });
     
     // More test cases...
     
     app.listen(8080);
     ```

2. **Test with Real Phishing URLs**:
   - Download recent PhishTank feeds
   - Test detection rate:
     ```javascript
     async function testPhishingDetection() {
       const phishingURLs = await fetchPhishTankURLs();
       const legitimateURLs = await fetchAlexaTop1000();
       
       let truePositives = 0;
       let falsePositives = 0;
       let trueNegatives = 0;
       let falseNegatives = 0;
       
       // Test phishing URLs
       for (const url of phishingURLs.slice(0, 100)) {
         const riskScore = await analyzeURL(url);
         if (riskScore > 70) truePositives++;
         else falseNegatives++;
       }
       
       // Test legitimate URLs
       for (const url of legitimateURLs) {
         const riskScore = await analyzeURL(url);
         if (riskScore < 30) trueNegatives++;
         else falsePositives++;
       }
       
       console.log('True Positives:', truePositives);
       console.log('False Positives:', falsePositives);
       console.log('True Negatives:', trueNegatives);
       console.log('False Negatives:', falseNegatives);
       
       const accuracy = (truePositives + trueNegatives) / (phishingURLs.length + legitimateURLs.length);
       console.log('Accuracy:', accuracy);
     }
     ```

3. **Performance Testing**:
   - Benchmark feature extraction speed:
     ```javascript
     async function benchmarkPerformance() {
       const testPages = await loadTestPages(100);
       
       const start = performance.now();
       
       for (const page of testPages) {
         await extractFeatures(page);
         await runMLInference(features);
       }
       
       const end = performance.now();
       const avgTime = (end - start) / testPages.length;
       
       console.log(`Average analysis time: ${avgTime}ms`);
       
       // Should be < 100ms per page
       expect(avgTime).toBeLessThan(100);
     }
     ```

4. **Iterative Refinement**:
   - Analyze false positives/negatives
   - Tune model thresholds
   - Add new features if needed
   - Retrain model with corrections:
     ```python
     # Collect misclassified examples
     false_positives = []
     false_negatives = []
     
     # Add to training data
     df_corrections = pd.DataFrame([
         *false_positives,
         *false_negatives
     ])
     
     # Retrain with corrections
     trainer.retrain(df_corrections)
     ```

5. **Document Code and Maintain Changelog**:
   - Add JSDoc comments:
     ```javascript
     /**
      * Analyzes a web page for phishing indicators.
      * @param {Object} features - Extracted page features
      * @param {boolean} features.usesHTTPS - Whether page uses HTTPS
      * @param {number} features.loginForms - Count of login forms
      * @returns {Promise<RiskAssessment>} Risk assessment result
      */
     async function analyzePageForPhishing(features) {
       // ...
     }
     ```
   
   - Maintain `/CHANGELOG.md`:
     ```markdown
     # Changelog
     
     ## [0.1.0] - 2025-01-01
     ### Added
     - Initial phishing detection with Random Forest model
     - Tamper-evident logging system
     - Federated learning client
     
     ### Security
     - Implemented input validation for all external data
     - Added CSP enforcement
     - Eliminated use of eval() and unsafe innerHTML
     ```

### Expected Outcome
- Test suite covering phishing and legitimate pages
- >90% detection rate on PhishTank dataset
- <5% false positive rate on legitimate sites
- <100ms average analysis time
- Well-documented codebase
- Changelog tracking all changes

---

## Verification Checklist

- [ ] Training dataset collected (50k+ examples)
- [ ] ML model trained with >95% accuracy
- [ ] Model exported to ONNX format
- [ ] Model integrated into extension
- [ ] All code follows secure coding practices
- [ ] No use of eval(), innerHTML with untrusted data
- [ ] Input validation on all external data
- [ ] Unit test coverage >80%
- [ ] Integration tests pass
- [ ] E2E tests with extension pass
- [ ] Tested on 100+ real phishing URLs
- [ ] False positive rate <5%
- [ ] Performance <100ms per page
- [ ] Code fully documented with JSDoc
- [ ] CHANGELOG.md maintained

## Testing Commands

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run E2E tests
npm run test:e2e

# Build extension for testing
npm run build

# Start test server
npm run test:server

# Run performance benchmarks
npm run benchmark
```

## Next Phase
Proceed to Phase 6: Mac (M1/M4) Compatibility & Performance
