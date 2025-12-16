# Phase 4: Tamper-Evident Logging (Blockchain Option)

## Overview
Implement an append-only, tamper-evident audit log using cryptographic hash chains and optional blockchain anchoring. This ensures all agent activities and security events are traceable and cannot be altered without detection.

## Prerequisites
- Phase 1-3 completed (foundation, ML, phishing detection)
- Understanding of cryptographic hash functions
- Knowledge of Merkle trees and blockchain concepts
- Familiarity with Web Crypto API

## Step 1: Implement Hash-Chain Audit Log

### Objective
Create an append-only log where each entry is cryptographically linked to the previous entry.

### Actions
1. **Design Log Entry Structure**:
   - Create `/src/logging/log-entry.js`:
     ```javascript
     class LogEntry {
       constructor(eventType, data, previousHash) {
         this.id = this.generateId();
         this.timestamp = Date.now();
         this.eventType = eventType; // 'PHISHING_DETECTED', 'USER_OVERRIDE', etc.
         this.data = this.sanitizeData(data);
         this.previousHash = previousHash || '0'.repeat(64); // Genesis entry
         this.hash = null; // Computed after creation
       }
       
       sanitizeData(data) {
         // Remove PII, keep only relevant metadata
         return {
           url: data.url ? this.hashURL(data.url) : null,
           riskScore: data.riskScore,
           action: data.action,
           features: data.features ? this.anonymizeFeatures(data.features) : null,
           // No personal data, actual URLs, or identifiable info
         };
       }
       
       hashURL(url) {
         // One-way hash of URL for privacy
         return this.sha256(url);
       }
       
       anonymizeFeatures(features) {
         // Keep only ML-relevant, non-identifying features
         return {
           urlLength: features.urlLength,
           hasHTTPS: features.usesHTTPS,
           formCount: features.formCount,
           // No actual content or identifiable data
         };
       }
       
       async computeHash() {
         const data = JSON.stringify({
           id: this.id,
           timestamp: this.timestamp,
           eventType: this.eventType,
           data: this.data,
           previousHash: this.previousHash
         });
         
         this.hash = await this.sha256(data);
         return this.hash;
       }
       
       async sha256(message) {
         const msgBuffer = new TextEncoder().encode(message);
         const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
         const hashArray = Array.from(new Uint8Array(hashBuffer));
         return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
       }
       
       generateId() {
         return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
       }
     }
     ```

2. **Create Hash Chain Manager**:
   - Build `/src/logging/hash-chain.js`:
     ```javascript
     class HashChain {
       constructor() {
         this.currentHash = null;
         this.entryCount = 0;
       }
       
       async appendEntry(eventType, data) {
         const entry = new LogEntry(eventType, data, this.currentHash);
         await entry.computeHash();
         
         // Store entry
         await this.storeEntry(entry);
         
         // Update chain state
         this.currentHash = entry.hash;
         this.entryCount++;
         
         return entry;
       }
       
       async storeEntry(entry) {
         // Store in IndexedDB
         const db = await this.openDatabase();
         const tx = db.transaction('auditLog', 'readwrite');
         const store = tx.objectStore('auditLog');
         
         await store.add({
           id: entry.id,
           timestamp: entry.timestamp,
           eventType: entry.eventType,
           data: entry.data,
           previousHash: entry.previousHash,
           hash: entry.hash
         });
       }
       
       async verifyIntegrity() {
         const entries = await this.getAllEntries();
         let expectedHash = null;
         
         for (let i = 0; i < entries.length; i++) {
           const entry = entries[i];
           
           // Check if previousHash matches
           if (entry.previousHash !== (expectedHash || '0'.repeat(64))) {
             return {
               valid: false,
               corruptedAt: i,
               message: `Chain broken at entry ${i}`
             };
           }
           
           // Recompute hash
           const logEntry = new LogEntry(
             entry.eventType,
             entry.data,
             entry.previousHash
           );
           logEntry.id = entry.id;
           logEntry.timestamp = entry.timestamp;
           const recomputedHash = await logEntry.computeHash();
           
           if (recomputedHash !== entry.hash) {
             return {
               valid: false,
               corruptedAt: i,
               message: `Hash mismatch at entry ${i}`
             };
           }
           
           expectedHash = entry.hash;
         }
         
         return { valid: true, entriesVerified: entries.length };
       }
     }
     ```

3. **Implement Encrypted Storage**:
   - Add encryption layer for sensitive log data:
     ```javascript
     class EncryptedLogStorage {
       async encrypt(data, key) {
         const iv = crypto.getRandomValues(new Uint8Array(12));
         const encoded = new TextEncoder().encode(JSON.stringify(data));
         
         const encrypted = await crypto.subtle.encrypt(
           { name: 'AES-GCM', iv: iv },
           key,
           encoded
         );
         
         return {
           iv: Array.from(iv),
           data: Array.from(new Uint8Array(encrypted))
         };
       }
       
       async decrypt(encryptedData, key) {
         const decrypted = await crypto.subtle.decrypt(
           { name: 'AES-GCM', iv: new Uint8Array(encryptedData.iv) },
           key,
           new Uint8Array(encryptedData.data)
         );
         
         return JSON.parse(new TextDecoder().decode(decrypted));
       }
     }
     ```

4. **Create Database Schema**:
   - Set up IndexedDB for log storage:
     ```javascript
     async function initializeLogDatabase() {
       return new Promise((resolve, reject) => {
         const request = indexedDB.open('TamperEvidentLog', 1);
         
         request.onupgradeneeded = (event) => {
           const db = event.target.result;
           
           // Audit log store
           const logStore = db.createObjectStore('auditLog', { keyPath: 'id' });
           logStore.createIndex('timestamp', 'timestamp', { unique: false });
           logStore.createIndex('eventType', 'eventType', { unique: false });
           
           // Merkle tree store
           const merkleStore = db.createObjectStore('merkleTrees', { keyPath: 'blockId' });
           merkleStore.createIndex('timestamp', 'timestamp', { unique: false });
         };
         
         request.onsuccess = () => resolve(request.result);
         request.onerror = () => reject(request.error);
       });
     }
     ```

### Expected Outcome
- Hash-chained audit log implemented
- Each log entry cryptographically linked
- Encrypted storage for sensitive data
- Integrity verification function working

---

## Step 2: Implement Merkle Tree for Scalability

### Objective
Use Merkle trees to efficiently batch log entries and create verifiable snapshots.

### Actions
1. **Create Merkle Tree Implementation**:
   - Build `/src/logging/merkle-tree.js`:
     ```javascript
     class MerkleTree {
       constructor(leaves) {
         this.leaves = leaves;
         this.tree = this.buildTree();
         this.root = this.tree[this.tree.length - 1][0];
       }
       
       async buildTree() {
         let currentLevel = await Promise.all(
           this.leaves.map(leaf => this.hash(leaf))
         );
         
         const tree = [currentLevel];
         
         while (currentLevel.length > 1) {
           const nextLevel = [];
           
           for (let i = 0; i < currentLevel.length; i += 2) {
             const left = currentLevel[i];
             const right = currentLevel[i + 1] || left; // Duplicate if odd
             const parent = await this.hash(left + right);
             nextLevel.push(parent);
           }
           
           tree.push(nextLevel);
           currentLevel = nextLevel;
         }
         
         return tree;
       }
       
       async hash(data) {
         const msgBuffer = new TextEncoder().encode(data);
         const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
         const hashArray = Array.from(new Uint8Array(hashBuffer));
         return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
       }
       
       getRoot() {
         return this.root;
       }
       
       getProof(index) {
         // Generate Merkle proof for leaf at index
         const proof = [];
         let currentIndex = index;
         
         for (let level = 0; level < this.tree.length - 1; level++) {
           const levelNodes = this.tree[level];
           const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
           
           if (siblingIndex < levelNodes.length) {
             proof.push({
               hash: levelNodes[siblingIndex],
               position: currentIndex % 2 === 0 ? 'right' : 'left'
             });
           }
           
           currentIndex = Math.floor(currentIndex / 2);
         }
         
         return proof;
       }
       
       static async verifyProof(leaf, proof, root) {
         let hash = await new MerkleTree([]).hash(leaf);
         
         for (const { hash: siblingHash, position } of proof) {
           const combined = position === 'left'
             ? siblingHash + hash
             : hash + siblingHash;
           hash = await new MerkleTree([]).hash(combined);
         }
         
         return hash === root;
       }
     }
     ```

2. **Implement Block Creation**:
   - Batch log entries into blocks (e.g., daily or every 1000 entries):
     ```javascript
     class LogBlockManager {
       constructor() {
         this.currentBlock = [];
         this.blockSize = 1000; // Entries per block
         this.dailyBlock = true; // Also create daily blocks
       }
       
       async addEntry(entry) {
         this.currentBlock.push(entry);
         
         // Check if block should be finalized
         const shouldFinalize = this.currentBlock.length >= this.blockSize
           || this.isDayBoundary();
         
         if (shouldFinalize) {
           await this.finalizeBlock();
         }
       }
       
       async finalizeBlock() {
         if (this.currentBlock.length === 0) return;
         
         // Create Merkle tree from block entries
         const leaves = this.currentBlock.map(entry => 
           JSON.stringify(entry)
         );
         const merkleTree = new MerkleTree(leaves);
         const root = merkleTree.getRoot();
         
         // Save block metadata
         const block = {
           blockId: `block-${Date.now()}`,
           timestamp: Date.now(),
           entryCount: this.currentBlock.length,
           firstEntry: this.currentBlock[0].id,
           lastEntry: this.currentBlock[this.currentBlock.length - 1].id,
           merkleRoot: root,
           previousBlockRoot: await this.getPreviousBlockRoot()
         };
         
         await this.saveBlock(block);
         
         // Reset current block
         this.currentBlock = [];
         
         return block;
       }
       
       isDayBoundary() {
         if (!this.currentBlock.length) return false;
         const firstEntry = this.currentBlock[0];
         const dayStart = new Date().setHours(0, 0, 0, 0);
         return firstEntry.timestamp < dayStart;
       }
     }
     ```

3. **Create Block Verification**:
   - Verify entire blocks efficiently:
     ```javascript
     async function verifyBlock(blockId) {
       const block = await getBlock(blockId);
       const entries = await getBlockEntries(block.firstEntry, block.lastEntry);
       
       // Rebuild Merkle tree
       const leaves = entries.map(e => JSON.stringify(e));
       const tree = new MerkleTree(leaves);
       const computedRoot = tree.getRoot();
       
       // Compare with stored root
       return computedRoot === block.merkleRoot;
     }
     ```

### Expected Outcome
- Merkle tree implementation for log batching
- Efficient block creation and storage
- Block verification capability
- Merkle proofs for individual entries

---

## Step 3: Implement Blockchain Anchoring

### Objective
Periodically anchor Merkle roots to a public blockchain or timestamping service for external verification.

### Actions
1. **Choose Anchoring Service**:
   - **Option A: Public Blockchain (Ethereum, Bitcoin)**
     - Pros: Maximally decentralized, tamper-proof
     - Cons: Transaction costs, complexity
   - **Option B: Timestamping Service (OpenTimestamps)**
     - Pros: Free, easier integration
     - Cons: Less decentralized
   - **Option C: Permissioned Ledger (Hyperledger)**
     - Pros: Lower cost, controlled access
     - Cons: Not fully decentralized
   
   **Recommendation**: Start with OpenTimestamps for cost-effectiveness

2. **Implement OpenTimestamps Integration**:
   - Add OpenTimestamps library:
     ```bash
     npm install opentimestamps
     ```
   - Create anchoring service:
     ```javascript
     import { timestamp, verify } from 'opentimestamps';
     
     class TimestampAnchor {
       async anchorMerkleRoot(merkleRoot) {
         try {
           // Create timestamp
           const rootBuffer = Buffer.from(merkleRoot, 'hex');
           const ots = timestamp(rootBuffer);
           
           // Store OTS proof
           await this.storeOTSProof(merkleRoot, ots);
           
           return {
             success: true,
             merkleRoot: merkleRoot,
             otsProof: ots.toString('hex')
           };
         } catch (error) {
           console.error('Anchoring failed:', error);
           return { success: false, error: error.message };
         }
       }
       
       async verifyAnchor(merkleRoot, otsProof) {
         const rootBuffer = Buffer.from(merkleRoot, 'hex');
         const proofBuffer = Buffer.from(otsProof, 'hex');
         
         const result = await verify(proofBuffer, rootBuffer);
         
         return {
           verified: result.timestamp !== undefined,
           timestamp: result.timestamp,
           blockHeight: result.height
         };
       }
     }
     ```

3. **Create Periodic Anchoring Schedule**:
   - Anchor Merkle roots daily or weekly:
     ```javascript
     class AnchorScheduler {
       constructor() {
         this.interval = 24 * 60 * 60 * 1000; // Daily
       }
       
       start() {
         chrome.alarms.create('anchorMerkleRoot', {
           periodInMinutes: 1440 // 24 hours
         });
         
         chrome.alarms.onAlarm.addListener(async (alarm) => {
           if (alarm.name === 'anchorMerkleRoot') {
             await this.performAnchoring();
           }
         });
       }
       
       async performAnchoring() {
         // Get latest finalized block
         const latestBlock = await getLatestBlock();
         if (!latestBlock) return;
         
         // Check if already anchored
         if (latestBlock.anchored) return;
         
         // Anchor to blockchain/timestamp service
         const anchor = new TimestampAnchor();
         const result = await anchor.anchorMerkleRoot(latestBlock.merkleRoot);
         
         if (result.success) {
           // Update block with anchor info
           await updateBlock(latestBlock.blockId, {
             anchored: true,
             anchorProof: result.otsProof,
             anchorTimestamp: Date.now()
           });
         }
       }
     }
     ```

4. **Alternative: Ethereum Smart Contract** (Optional):
   - Simple anchoring contract:
     ```solidity
     // SPDX-License-Identifier: MIT
     pragma solidity ^0.8.0;
     
     contract LogAnchor {
       mapping(bytes32 => uint256) public anchors;
       event MerkleRootAnchored(bytes32 indexed root, uint256 timestamp);
       
       function anchor(bytes32 merkleRoot) external {
         require(anchors[merkleRoot] == 0, "Already anchored");
         anchors[merkleRoot] = block.timestamp;
         emit MerkleRootAnchored(merkleRoot, block.timestamp);
       }
       
       function verify(bytes32 merkleRoot) external view returns (bool, uint256) {
         uint256 timestamp = anchors[merkleRoot];
         return (timestamp != 0, timestamp);
       }
     }
     ```

### Expected Outcome
- Blockchain/timestamp anchoring service integrated
- Periodic anchoring of Merkle roots
- Verification capability for anchored roots
- External proof of log integrity

---

## Step 4: Create Audit and Verification UI

### Objective
Build user-facing tools for viewing logs and verifying integrity.

### Actions
1. **Create Audit Log Viewer**:
   - Build UI component `/src/popup/audit-viewer.html`:
     ```html
     <div id="audit-viewer">
       <h2>Tamper-Evident Audit Log</h2>
       
       <div class="stats">
         <div class="stat">
           <span class="label">Total Entries:</span>
           <span id="total-entries">0</span>
         </div>
         <div class="stat">
           <span class="label">Chain Integrity:</span>
           <span id="chain-status" class="status-ok">✓ Verified</span>
         </div>
         <div class="stat">
           <span class="label">Last Anchor:</span>
           <span id="last-anchor">Never</span>
         </div>
       </div>
       
       <button id="verify-integrity-btn">Verify Full Chain</button>
       
       <div class="log-entries">
         <table>
           <thead>
             <tr>
               <th>Timestamp</th>
               <th>Event Type</th>
               <th>Risk Score</th>
               <th>Action</th>
               <th>Hash</th>
             </tr>
           </thead>
           <tbody id="log-entries-body">
             <!-- Populated dynamically -->
           </tbody>
         </table>
       </div>
     </div>
     ```

2. **Implement Verification Tools**:
   - Create verification script:
     ```javascript
     class AuditVerification {
       async runFullVerification() {
         const results = {
           hashChainValid: false,
           merkleBlocksValid: false,
           anchoredBlocksValid: false,
           details: []
         };
         
         // Verify hash chain
         const hashChain = new HashChain();
         const chainResult = await hashChain.verifyIntegrity();
         results.hashChainValid = chainResult.valid;
         results.details.push(`Hash chain: ${chainResult.message || 'OK'}`);
         
         // Verify Merkle blocks
         const blocks = await getAllBlocks();
         let allBlocksValid = true;
         
         for (const block of blocks) {
           const blockValid = await verifyBlock(block.blockId);
           if (!blockValid) {
             allBlocksValid = false;
             results.details.push(`Block ${block.blockId} verification failed`);
           }
         }
         results.merkleBlocksValid = allBlocksValid;
         
         // Verify anchored blocks
         const anchor = new TimestampAnchor();
         let allAnchorsValid = true;
         
         for (const block of blocks.filter(b => b.anchored)) {
           const anchorResult = await anchor.verifyAnchor(
             block.merkleRoot,
             block.anchorProof
           );
           if (!anchorResult.verified) {
             allAnchorsValid = false;
             results.details.push(`Block ${block.blockId} anchor invalid`);
           }
         }
         results.anchoredBlocksValid = allAnchorsValid;
         
         return results;
       }
     }
     ```

3. **Create Export Functionality**:
   - Allow exporting logs for external audit:
     ```javascript
     async function exportAuditLog() {
       const entries = await getAllEntries();
       const blocks = await getAllBlocks();
       
       const exportData = {
         exportTimestamp: Date.now(),
         version: '1.0',
         entries: entries,
         blocks: blocks,
         verificationData: await runFullVerification()
       };
       
       // Create downloadable file
       const blob = new Blob(
         [JSON.stringify(exportData, null, 2)],
         { type: 'application/json' }
       );
       
       const url = URL.createObjectURL(blob);
       chrome.downloads.download({
         url: url,
         filename: `audit-log-${Date.now()}.json`,
         saveAs: true
       });
     }
     ```

4. **Add Compliance Reporting**:
   - Generate compliance reports:
     ```javascript
     class ComplianceReport {
       async generate(startDate, endDate) {
         const entries = await getEntriesByDateRange(startDate, endDate);
         
         const report = {
           period: { start: startDate, end: endDate },
           summary: {
             totalEvents: entries.length,
             phishingDetected: 0,
             userOverrides: 0,
             blockedPages: 0
           },
           eventBreakdown: {},
           riskDistribution: { low: 0, medium: 0, high: 0 },
           integrityChecks: await this.verifyPeriodIntegrity(entries)
         };
         
         // Process entries
         entries.forEach(entry => {
           // Count by event type
           report.eventBreakdown[entry.eventType] =
             (report.eventBreakdown[entry.eventType] || 0) + 1;
           
           // Count by risk level
           if (entry.data.riskScore) {
             if (entry.data.riskScore > 70) report.riskDistribution.high++;
             else if (entry.data.riskScore > 30) report.riskDistribution.medium++;
             else report.riskDistribution.low++;
           }
         });
         
         return report;
       }
     }
     ```

### Expected Outcome
- Audit log viewer UI working
- Full integrity verification tool
- Export functionality for external audits
- Compliance reporting capability

---

## Verification Checklist

- [ ] Hash chain implemented with SHA-256
- [ ] Each log entry links to previous entry
- [ ] Integrity verification detects any tampering
- [ ] Merkle trees batch entries into blocks
- [ ] Merkle root computation correct
- [ ] Blockchain/timestamp anchoring working
- [ ] Anchored roots verifiable externally
- [ ] Audit log viewer displays all entries
- [ ] Verification tool runs successfully
- [ ] Export functionality creates valid JSON
- [ ] No sensitive/PII data in logs
- [ ] All events logged (detections, overrides, etc.)

## Security Considerations

**What is Logged:**
- Event type and timestamp
- Anonymized risk scores
- User actions (blocked/proceeded)
- Non-identifying features
- Hashed URLs (not actual URLs)

**What is NOT Logged:**
- Actual URLs or page content
- Personal identifiable information
- User credentials or passwords
- Browsing history details

**Tamper Evidence:**
- Any modification to past entries breaks the hash chain
- Merkle roots anchored externally provide proof of existence
- Integrity verification can detect any tampering attempt

## Next Phase
Proceed to Phase 5: Core Development (Models & Code from Scratch)
