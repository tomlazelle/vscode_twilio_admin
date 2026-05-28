import * as vscode from 'vscode';
import type { UiTypographySettings } from '../types/typography.js';

const MIN_SIZE = 8;
const MAX_SIZE = 32;

function clampSize(value: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, value));
}

function getNumericSetting(fullKey: string): number | undefined {
  const raw = vscode.workspace.getConfiguration().get<number>(fullKey);
  if (typeof raw === 'number' && !Number.isNaN(raw)) {
    return raw;
  }
  return undefined;
}

function getConfiguredSize(newKey: string, legacyOffsetKey: string, fallback: number): number {
  const size = getNumericSetting(newKey);
  if (typeof size === 'number' && size > 0) {
    return clampSize(size);
  }

  const legacyOffset = getNumericSetting(legacyOffsetKey);
  if (typeof legacyOffset === 'number' && legacyOffset !== 0) {
    return clampSize(fallback + legacyOffset);
  }

  return clampSize(fallback);
}

export function resolveUiTypographySettings(): UiTypographySettings {
  const editorFontSize = vscode.workspace
    .getConfiguration('editor')
    .get<number>('fontSize', 14);

  const base = getConfiguredSize(
    'twilioAdmin.ui.fontSize.baseSize',
    'twilioAdmin.ui.fontSize.baseOffset',
    editorFontSize
  );

  return {
    bookmarkDetail: {
      header: getConfiguredSize('twilioAdmin.ui.fontSize.bookmarkDetail.headerSize', 'twilioAdmin.ui.fontSize.bookmarkDetail.headerOffset', base),
      metadata: getConfiguredSize('twilioAdmin.ui.fontSize.bookmarkDetail.metadataSize', 'twilioAdmin.ui.fontSize.bookmarkDetail.metadataOffset', base),
      logsTable: getConfiguredSize('twilioAdmin.ui.fontSize.bookmarkDetail.logsTableSize', 'twilioAdmin.ui.fontSize.bookmarkDetail.logsTableOffset', base),
      events: getConfiguredSize('twilioAdmin.ui.fontSize.bookmarkDetail.eventsSize', 'twilioAdmin.ui.fontSize.bookmarkDetail.eventsOffset', base),
      json: getConfiguredSize('twilioAdmin.ui.fontSize.bookmarkDetail.jsonSize', 'twilioAdmin.ui.fontSize.bookmarkDetail.jsonOffset', base),
      toolbar: getConfiguredSize('twilioAdmin.ui.fontSize.bookmarkDetail.toolbarSize', 'twilioAdmin.ui.fontSize.bookmarkDetail.toolbarOffset', base),
    },
    numberBrowser: {
      header: getConfiguredSize('twilioAdmin.ui.fontSize.numberBrowser.headerSize', 'twilioAdmin.ui.fontSize.numberBrowser.headerOffset', base),
      filters: getConfiguredSize('twilioAdmin.ui.fontSize.numberBrowser.filtersSize', 'twilioAdmin.ui.fontSize.numberBrowser.filtersOffset', base),
      tableHeaders: getConfiguredSize('twilioAdmin.ui.fontSize.numberBrowser.tableHeadersSize', 'twilioAdmin.ui.fontSize.numberBrowser.tableHeadersOffset', base),
      tableRows: getConfiguredSize('twilioAdmin.ui.fontSize.numberBrowser.tableRowsSize', 'twilioAdmin.ui.fontSize.numberBrowser.tableRowsOffset', base),
      metaText: getConfiguredSize('twilioAdmin.ui.fontSize.numberBrowser.metaTextSize', 'twilioAdmin.ui.fontSize.numberBrowser.metaTextOffset', base),
    },
    accountForm: {
      header: getConfiguredSize('twilioAdmin.ui.fontSize.accountForm.headerSize', 'twilioAdmin.ui.fontSize.accountForm.headerOffset', base),
      labels: getConfiguredSize('twilioAdmin.ui.fontSize.accountForm.labelsSize', 'twilioAdmin.ui.fontSize.accountForm.labelsOffset', base),
      inputs: getConfiguredSize('twilioAdmin.ui.fontSize.accountForm.inputsSize', 'twilioAdmin.ui.fontSize.accountForm.inputsOffset', base),
      helpText: getConfiguredSize('twilioAdmin.ui.fontSize.accountForm.helpTextSize', 'twilioAdmin.ui.fontSize.accountForm.helpTextOffset', base),
      buttons: getConfiguredSize('twilioAdmin.ui.fontSize.accountForm.buttonsSize', 'twilioAdmin.ui.fontSize.accountForm.buttonsOffset', base),
    },
  };
}
