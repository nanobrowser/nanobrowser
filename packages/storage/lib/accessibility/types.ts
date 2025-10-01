export interface AccessibilityReport {
  pageUrl: string;
  pageSummary: string;
  imageAnalysis?: {
    imageUrl: string;
    currentAlt: string;
    generatedAlt?: string;
  }[];
  createdAt: number;
  updatedAt: number;
}

export interface AccessibilityReportStorage {
  getAccessibilityReport: (pageUrl: string) => Promise<AccessibilityReport | null>;
  saveAccessibilityReport: (report: AccessibilityReport) => Promise<void>;
  deleteAccessibilityReport: (pageUrl: string) => Promise<void>;
  deleteAllReports: () => Promise<void>;
}
