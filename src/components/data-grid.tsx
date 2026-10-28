"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type RowClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid Community, themed with Honorarium's tokens so it follows light and dark mode. */
const theme = themeQuartz.withParams({
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--ink)",
  borderColor: "var(--rule)",
  chromeBackgroundColor: "var(--subtle)",
  accentColor: "var(--primary)",
  browserColorScheme: "inherit",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  headerFontWeight: 700,
  borderRadius: 8,
  wrapperBorderRadius: 14,
  spacing: 7,
  rowHoverColor: "var(--primary-soft)",
  selectedRowBackgroundColor: "var(--primary-soft)",
});

export interface DataGridProps<T> {
  rows: T[];
  columns: ColDef<T>[];
  rowId: (row: T) => string;
  quickFilter?: string;
  onRowOpen?: (row: T) => void;
  height?: number;
  label: string;
}

export function DataGrid<T>({ rows, columns, rowId, quickFilter, onRowOpen, height = 560, label }: DataGridProps<T>) {
  return (
    <div style={{ height }} aria-label={label} role="region">
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        getRowId={(params) => rowId(params.data)}
        quickFilterText={quickFilter}
        ensureDomOrder
        animateRows={false}
        defaultColDef={{ sortable: true, resizable: true, filter: false, suppressMovable: true }}
        onRowClicked={(event: RowClickedEvent<T>) => {
          if (event.data && onRowOpen) {
            onRowOpen(event.data);
          }
        }}
        onCellKeyDown={(event) => {
          const keyboard = event.event as KeyboardEvent | null | undefined;
          if (keyboard?.key === "Enter" && event.data && onRowOpen) {
            onRowOpen(event.data as T);
          }
        }}
        overlayNoRowsTemplate="No rows match."
      />
    </div>
  );
}
