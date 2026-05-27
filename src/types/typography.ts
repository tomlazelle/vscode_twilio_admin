export interface BookmarkDetailTypographySettings {
  header: number;
  metadata: number;
  logsTable: number;
  events: number;
  json: number;
  toolbar: number;
}

export interface NumberBrowserTypographySettings {
  header: number;
  filters: number;
  tableHeaders: number;
  tableRows: number;
  metaText: number;
}

export interface AccountFormTypographySettings {
  header: number;
  labels: number;
  inputs: number;
  helpText: number;
  buttons: number;
}

export interface UiTypographySettings {
  bookmarkDetail: BookmarkDetailTypographySettings;
  numberBrowser: NumberBrowserTypographySettings;
  accountForm: AccountFormTypographySettings;
}
