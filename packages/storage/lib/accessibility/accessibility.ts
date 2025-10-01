import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';
import type { AccessibilityReport, AccessibilityReportStorage } from './types';

const ACCESSIBILITY_REPORTS_KEY = 'accessibility_reports';

const accessibilityReportsStorage = createStorage<Record<string, AccessibilityReport>>(
  ACCESSIBILITY_REPORTS_KEY,
  {},
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  },
);

const getCurrentTimestamp = (): number => Date.now();

export function createAccessibilityStorage(): AccessibilityReportStorage {
  return {
    getAccessibilityReport: async (pageUrl: string): Promise<AccessibilityReport | null> => {
      const reports = await accessibilityReportsStorage.get();
      return reports[pageUrl] || null;
    },

    saveAccessibilityReport: async (report: AccessibilityReport): Promise<void> => {
      const currentTime = getCurrentTimestamp();
      const updatedReport: AccessibilityReport = {
        ...report,
        updatedAt: currentTime,
        createdAt: report.createdAt || currentTime,
      };

      await accessibilityReportsStorage.set(prevReports => ({
        ...prevReports,
        [report.pageUrl]: updatedReport,
      }));
    },

    deleteAccessibilityReport: async (pageUrl: string): Promise<void> => {
      await accessibilityReportsStorage.set(prevReports => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [pageUrl]: _, ...remainingReports } = prevReports;
        return remainingReports;
      });
    },

    deleteAllReports: async (): Promise<void> => {
      await accessibilityReportsStorage.set({});
    },
  };
}

export const accessibilityStore = createAccessibilityStorage();
