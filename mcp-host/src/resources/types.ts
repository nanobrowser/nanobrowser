export interface BrowserState {
  activeTab?: {
    id?: number;
    url?: string;
    title?: string;
    domState?: any;
  };
  tabs?: Array<{
    id?: number;
    url?: string;
    title?: string;
    active?: boolean;
  }>;
}

export interface Resource {
  uri: string;
  name: string;
  mimeType: string;
  description: string;
  read: () => Promise<{
    contents: Array<{
      uri: string;
      mimeType: string;
      text: string;
    }>;
  }>;
}
